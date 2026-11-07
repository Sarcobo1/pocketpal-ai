import {runInAction} from 'mobx';

import {ASR_CHUNK_BYTES} from '../../asr/constants';
import {
  chatSessionStore,
  modelStore,
  ttsStore,
  voiceModeStore,
} from '../../../store';
import {closeTurnTimeline, openTurnTimeline} from '../../../utils/mediaPerf';

import {OmniVoiceEngine, isOmniVoiceModel} from '../omniEngine';
import {setVoiceFrameSource} from '../frameSource';
import {VOICE_CLIP_MIN_RMS} from '../constants';
import type {VoiceTurnEvents, VoiceTurnPayload} from '../types';

const chat = chatSessionStore as any;

const speech = (ms: number, amplitude = 0.1): Uint8Array => {
  const bytes = (ms / 50) * ASR_CHUNK_BYTES;
  const pcm = new Uint8Array(bytes);
  const view = new DataView(pcm.buffer);
  for (let i = 0; i < bytes / 2; i++) {
    view.setInt16(i * 2, (i % 2 ? 1 : -1) * amplitude * 0x7fff, true);
  }
  return pcm;
};

const flush = () => new Promise(resolve => setImmediate(resolve));

function makePort() {
  const port = {
    onTurn: null as ((id: string) => void) | null,
    settle: () => {},
    send: jest.fn(),
    stop: jest.fn(),
  };
  port.send.mockImplementation(
    (_payload: VoiceTurnPayload, onTurn: (id: string) => void) => {
      port.onTurn = onTurn;
      return new Promise<void>(resolve => {
        port.settle = resolve;
      });
    },
  );
  return port;
}

const events = (): jest.Mocked<VoiceTurnEvents> => ({
  transcribed: jest.fn(),
  speechStarted: jest.fn(),
});

describe('OmniVoiceEngine', () => {
  const engine = new OmniVoiceEngine();
  let savedSessions: unknown;

  beforeEach(() => {
    savedSessions = chat.sessions;
  });

  afterEach(() => {
    chat.sessions = savedSessions;
    setVoiceFrameSource(null);
    runInAction(() => {
      voiceModeStore.cameraOn = false;
      ttsStore.voiceSpeechStarted = null;
      ttsStore.voiceStreamFailed = null;
      ttsStore.playbackState = {mode: 'idle'};
    });
    jest.clearAllMocks();
  });

  it('sends the utterance as a WAV, with no transcript', async () => {
    const port = makePort();
    const on = events();
    const turn = engine.runTurn(speech(500), port, on);

    await flush();

    expect(on.transcribed).toHaveBeenCalledWith('');
    const payload = port.send.mock.calls[0][0] as VoiceTurnPayload;
    expect(payload.text).toBe('');
    expect(payload.audioUri).toMatch(/\/voice-audio\/utt-\d+\.wav$/);

    chat.sessions = [
      {
        id: 'session-1',
        messages: [
          {id: 'turn-1', type: 'assistant_turn', steps: [], metadata: {}},
        ],
      },
    ];
    port.onTurn!('turn-1');
    port.settle();

    await expect(turn.done).resolves.toBe('answered');
  });

  it('waits for the model to stop voicing before it submits the clip', async () => {
    // One claim per context, and the bridge throws at a second taker: a clip
    // put in front of a speech decode is a turn that never started, and the
    // listener hears "Couldn't get an answer" for a question the model saw.
    runInAction(() => {
      (modelStore as any).engine = {name: 'omni'};
    });
    const speaking = await modelStore.acquireGeneration('speech');
    const port = makePort();
    const events2 = events();
    const turn = engine.runTurn(speech(500), port, events2);

    await flush();
    expect(port.send).not.toHaveBeenCalled();
    expect(modelStore.generationHolder).toBe('speech');

    speaking!.end();
    await flush();
    expect(port.send).toHaveBeenCalledTimes(1);

    chat.sessions = [
      {
        id: 'session-1',
        messages: [
          {id: 'turn-1', type: 'assistant_turn', steps: [], metadata: {}},
        ],
      },
    ];
    port.onTurn!('turn-1');
    port.settle();
    await expect(turn.done).resolves.toBe('answered');

    runInAction(() => {
      (modelStore as any).engine = undefined;
    });
  });

  it('sends what the camera saw along with the audio', async () => {
    const frame = '/path/to/caches/voice-frames/frame-1.jpg';
    runInAction(() => {
      voiceModeStore.cameraOn = true;
    });
    setVoiceFrameSource(async () => `file://${frame}`);
    const port = makePort();

    const turn = engine.runTurn(speech(500), port, events());
    await flush();

    const payload = port.send.mock.calls[0][0] as VoiceTurnPayload;
    expect(payload.audioUri).toMatch(/\/voice-audio\/utt-\d+\.wav$/);
    expect(payload.imageUris).toEqual([`file://${frame}`]);

    chat.sessions = [
      {
        id: 'session-1',
        messages: [
          {id: 'turn-1', type: 'assistant_turn', steps: [], metadata: {}},
        ],
      },
    ];
    port.onTurn!('turn-1');
    port.settle();

    await expect(turn.done).resolves.toBe('answered');
  });

  const answerWith = (turnId: string) => {
    chat.sessions = [
      {
        id: 'session-1',
        messages: [
          {id: turnId, type: 'assistant_turn', steps: [], metadata: {}},
        ],
      },
    ];
  };

  it('holds the turn until the voice has finished the reply', async () => {
    const port = makePort();
    const turn = engine.runTurn(speech(500), port, events());
    await flush();
    answerWith('turn-1');
    port.onTurn!('turn-1');
    runInAction(() => {
      ttsStore.playbackState = {mode: 'playing', messageId: 'turn-1'};
    });
    port.settle();

    let outcome = 'pending';
    turn.done.then(value => {
      outcome = value;
    });
    await flush();
    expect(outcome).toBe('pending');

    runInAction(() => {
      ttsStore.playbackState = {mode: 'idle'};
    });
    await expect(turn.done).resolves.toBe('answered');
  });

  it('calls the turn spoken once its voice begins to play', async () => {
    const on = events();
    const port = makePort();
    const turn = engine.runTurn(speech(500), port, on);
    await flush();
    answerWith('turn-1');
    port.onTurn!('turn-1');

    runInAction(() => {
      ttsStore.voiceSpeechStarted = 'turn-1';
    });
    await flush();
    expect(on.speechStarted).toHaveBeenCalledTimes(1);

    port.settle();
    await expect(turn.done).resolves.toBe('answered');
  });

  it('reports a reply the voice could not speak', async () => {
    const port = makePort();
    const turn = engine.runTurn(speech(500), port, events());
    await flush();
    answerWith('turn-1');
    port.onTurn!('turn-1');
    runInAction(() => {
      ttsStore.voiceStreamFailed = 'turn-1';
    });
    port.settle();

    await expect(turn.done).resolves.toBe('speech_failed');
  });

  // A loud syllable in a quiet room: enough level to pass the RMS floor, not
  // enough of a run to be a question.
  const burst = (loudMs: number, totalMs: number): Uint8Array => {
    const loud = speech(loudMs);
    const quiet = speech(totalMs - loudMs, 0.0005);
    const pcm = new Uint8Array(loud.length + quiet.length);
    pcm.set(loud);
    pcm.set(quiet, loud.length);
    return pcm;
  };

  it.each([
    ['short', speech(200), 200, 0],
    ['silent', speech(500, 0.001), 500, 0],
    ['quiet', burst(120, 600), 600, 120],
  ] as const)(
    'sends nothing for a %s clip, and keeps its numbers on the turn',
    async (_reason, clip, ms, speechMs) => {
      openTurnTimeline();
      const port = makePort();
      const on = events();
      const turn = engine.runTurn(clip, port, on);

      await expect(turn.done).resolves.toBe('empty');
      expect(port.send).not.toHaveBeenCalled();
      expect(on.transcribed).not.toHaveBeenCalled();

      const {info} = closeTurnTimeline();
      expect(info.clipMs).toBe(ms);
      expect(info.speechMs).toBe(speechMs);
      expect(typeof info.clipRms).toBe('number');
    },
  );

  it('names the dropped clip in the line the phone prints', async () => {
    const printed: string[] = [];
    const log = jest.spyOn(console, 'log').mockImplementation(line => {
      printed.push(String(line));
    });
    // logPerf is silent under test; the line is what the report is read from,
    // so it is printed here the way the release APK prints it.
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const turn = engine.runTurn(speech(500, 0.001), makePort(), events());
      await expect(turn.done).resolves.toBe('empty');
    } finally {
      process.env.NODE_ENV = env;
      log.mockRestore();
    }

    expect(printed).toContain(
      '[framePerf] utt.drop reason=weak-clip gate=silent ms=500 rms=0.001 speechMs=0',
    );
  });

  it('carries the clip numbers on a turn that was sent', async () => {
    openTurnTimeline();
    const port = makePort();
    const turn = engine.runTurn(speech(500), port, events());
    await flush();
    answerWith('turn-1');
    port.onTurn!('turn-1');
    port.settle();
    await expect(turn.done).resolves.toBe('answered');

    const {info} = closeTurnTimeline();
    expect(info.clipMs).toBe(500);
    expect(info.speechMs).toBe(480);
    expect(info.clipRms).toBeGreaterThan(VOICE_CLIP_MIN_RMS);
  });

  it('stops the reply on interrupt and reports the turn as interrupted', async () => {
    const port = makePort();
    const turn = engine.runTurn(speech(500), port, events());

    await flush();
    const interrupted = turn.interrupt();
    expect(port.stop).toHaveBeenCalledTimes(1);
    port.settle();
    await interrupted;

    await expect(turn.done).resolves.toBe('interrupted');
  });

  it('reports a reply that never lands', async () => {
    const port = makePort();
    port.send.mockImplementationOnce(
      async (_payload: VoiceTurnPayload, onTurn: (id: string) => void) => {
        onTurn('turn-1');
        throw new Error('boom');
      },
    );
    const turn = engine.runTurn(speech(500), port, events());

    await expect(turn.done).resolves.toBe('reply_failed');
  });
});

describe('isOmniVoiceModel', () => {
  const store = modelStore as any;

  const withLoadedModel = (support: {vision: boolean; audio: boolean}) => {
    runInAction(() => {
      store.activeModelId = 'model-1';
      store.context = {
        getMultimodalSupport: jest.fn().mockResolvedValue(support),
      };
    });
  };

  beforeEach(() => {
    store.ensureMultimodalActive.mockReset();
    runInAction(() => {
      store.isMultimodalActive = false;
    });
  });

  it('puts the projector on the model before trusting the load-time flag', async () => {
    withLoadedModel({vision: true, audio: true});
    store.ensureMultimodalActive.mockResolvedValue(true);

    await expect(isOmniVoiceModel()).resolves.toBe(true);
    expect(store.ensureMultimodalActive).toHaveBeenCalledTimes(1);
  });

  it('is not an omni model while no projector can be attached', async () => {
    withLoadedModel({vision: true, audio: true});
    store.ensureMultimodalActive.mockResolvedValue(false);

    await expect(isOmniVoiceModel()).resolves.toBe(false);
  });

  it('is not an omni model when the projector cannot hear', async () => {
    withLoadedModel({vision: true, audio: false});
    store.ensureMultimodalActive.mockResolvedValue(true);

    await expect(isOmniVoiceModel()).resolves.toBe(false);
  });
});

import {runInAction} from 'mobx';

import {neuralAudioPlayer} from '@pocketpalai/react-native-speech/engine-sdk';

import {modelStore, ttsStore} from '../../../store';
import {ModelOrigin} from '../../../utils/types';

import {
  MAX_REALTIME_FACTOR,
  MAX_UTTERANCE_SECONDS,
  canIsolateSpeechSeq,
  modelCanVoiceReplies,
  prewarmSpeech,
  speakWithModel,
  stopModelSpeech,
} from '../omniSpeech';

const store = modelStore as any;
const tts = ttsStore as any;

/** A context the model's own voice could be asked of. */
let nextId = 1;
const withContext = (support: {
  vision: boolean;
  audio: boolean;
  audioGen: boolean;
}) => {
  const getMultimodalSupport = jest.fn().mockResolvedValue(support);
  runInAction(() => {
    store.activeModelId = 'model-1';
    store.context = {id: nextId++, getMultimodalSupport};
  });
  return getMultimodalSupport;
};

/** A model whose projector file carries a speech decoder. */
const withDeclaredVoice = (runtime: {
  vision: boolean;
  audio: boolean;
  audioGen: boolean;
}) => {
  const getMultimodalSupport = jest.fn().mockResolvedValue(runtime);
  runInAction(() => {
    store.models = [
      {
        id: 'model-1',
        origin: ModelOrigin.LOCAL,
        mediaSupport: {vision: true, audioInput: true, audioOutput: true},
      },
    ];
    store.activeModelId = 'model-1';
    store.isMultimodalActive = true;
    store.context = {id: nextId++, getMultimodalSupport};
  });
  return getMultimodalSupport;
};

describe('modelCanVoiceReplies', () => {
  beforeEach(() => {
    runInAction(() => {
      store.models = [];
      store.activeModelId = undefined;
      store.context = undefined;
      store.isMultimodalActive = false;
      tts.forceTTSFallback = false;
    });
  });

  it('is true for a context whose projector reports audioGen', async () => {
    const probe = withContext({vision: false, audio: true, audioGen: true});

    await expect(modelCanVoiceReplies()).resolves.toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('is false for a projector that carries no speech decoder', async () => {
    withContext({vision: true, audio: true, audioGen: false});

    await expect(modelCanVoiceReplies()).resolves.toBe(false);
  });

  it('keeps the answer for the context that gave it', async () => {
    const probe = withContext({vision: false, audio: true, audioGen: true});

    await modelCanVoiceReplies();
    await expect(modelCanVoiceReplies()).resolves.toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('asks again after a no, because a projector can arrive later', async () => {
    const probe = withContext({vision: true, audio: true, audioGen: false});
    await expect(modelCanVoiceReplies()).resolves.toBe(false);

    await expect(modelCanVoiceReplies()).resolves.toBe(false);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('asks a new context even when the old one could speak', async () => {
    withContext({vision: false, audio: true, audioGen: true});
    const probe = withContext({vision: false, audio: true, audioGen: false});

    await expect(modelCanVoiceReplies()).resolves.toBe(false);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('is false for a remote model, which has no context to speak with', async () => {
    runInAction(() => {
      store.models = [{id: 'remote-1', origin: ModelOrigin.REMOTE}];
      store.activeModelId = 'remote-1';
      store.context = {
        id: nextId++,
        getMultimodalSupport: jest.fn().mockResolvedValue({audioGen: true}),
      };
    });

    await expect(modelCanVoiceReplies()).resolves.toBe(false);
  });

  it('is false with no loaded model or no context', async () => {
    await expect(modelCanVoiceReplies()).resolves.toBe(false);

    runInAction(() => {
      store.activeModelId = 'model-1';
    });
    await expect(modelCanVoiceReplies()).resolves.toBe(false);
  });

  it('is true from the projector header when the runtime reports no voice', async () => {
    const probe = withDeclaredVoice({
      vision: true,
      audio: true,
      audioGen: false,
    });

    await expect(modelCanVoiceReplies()).resolves.toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('is false when neither the header nor the runtime reports a voice', async () => {
    withContext({vision: true, audio: true, audioGen: false});
    runInAction(() => {
      store.isMultimodalActive = true;
    });

    await expect(modelCanVoiceReplies()).resolves.toBe(false);
  });

  it('stays false when the debug switch forces the TTS voice', async () => {
    const probe = withContext({vision: false, audio: true, audioGen: true});
    runInAction(() => {
      tts.forceTTSFallback = true;
    });

    await expect(modelCanVoiceReplies()).resolves.toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });

  it('is false when the probe throws, and does not cache that', async () => {
    const id = nextId++;
    const getMultimodalSupport = jest
      .fn()
      .mockRejectedValue(new Error('no binding'));
    runInAction(() => {
      store.activeModelId = 'model-1';
      store.context = {id, getMultimodalSupport};
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(modelCanVoiceReplies()).resolves.toBe(false);
    await expect(modelCanVoiceReplies()).resolves.toBe(false);
    expect(getMultimodalSupport).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

/** Two seconds of audio made in one second: half of real time. */
const speechResult = (over: Record<string, unknown> = {}) => ({
  pcm: new Float32Array(48000).fill(0.25),
  sampleRate: 24000,
  frames: 60,
  seconds: 2,
  promptMs: 400,
  genMs: 1000,
  aborted: false,
  stopReason: 'eos',
  stage: 'eos',
  error: '',
  prompt: '<|speech_start|>english',
  ...over,
});

describe('speakWithModel', () => {
  const calls: string[] = [];
  let generateSpeech: jest.Mock;
  let clearCache: jest.Mock;
  let stopSpeech: jest.Mock;

  const withSpeaker = (result: Record<string, unknown>) => {
    runInAction(() => {
      store.activeModelId = 'model-1';
      store.context = {
        id: nextId++,
        generateSpeech,
        clearCache,
        stopSpeech,
        getMultimodalSupport: jest
          .fn()
          .mockResolvedValue({audioGen: true, audio: true}),
      };
    });
    generateSpeech.mockImplementation(async () => {
      calls.push('generate');
      return result;
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    calls.length = 0;
    generateSpeech = jest.fn();
    clearCache = jest.fn().mockImplementation(async () => {
      calls.push('clear');
    });
    stopSpeech = jest.fn();
    (neuralAudioPlayer.play as jest.Mock).mockImplementation(async () => {
      calls.push('play');
    });
    runInAction(() => {
      tts.speechLanguage = '';
      tts.forceTTSFallback = false;
      // This suite is the whole-buffer path: one clip, one play call. What the
      // engine hands over piece by piece is the suite below.
      tts.streamSpeech = false;
      tts.speechKeepCache = true;
      // The context these replies are asked of has the second slot that asking
      // needs; the suite that has only one is below.
      store.contextInitParams = {...store.contextInitParams, n_parallel: 2};
    });
  });

  it('plays the buffer the model made, at the rate it made it', async () => {
    withSpeaker(speechResult());

    const report = await speakWithModel('Salom');

    expect(report.spoken).toBe(true);
    expect(neuralAudioPlayer.play).toHaveBeenCalledWith(
      expect.objectContaining({
        sampleRate: 24000,
        channels: 1,
        duration: 2,
      }),
      {ducking: true},
    );
    const buffer = (neuralAudioPlayer.play as jest.Mock).mock.calls[0][0];
    expect(buffer.samples).toHaveLength(48000);
    expect(report.rtf).toBeCloseTo(0.5);
    expect(report.msPerFrame).toBeCloseTo(1000 / 60);
  });

  it('plays the samples it was handed, not the seconds it was told', async () => {
    // A codec that rounds its own clock, or a buffer cut at a limit, can leave
    // the two disagreeing. Told the longer length, the player takes the same
    // audio slow — which is what a listener hears as a drawn-out voice.
    withSpeaker(speechResult({pcm: new Float32Array(28800).fill(0.25)}));

    await speakWithModel('Salom');

    const [clip] = (neuralAudioPlayer.play as jest.Mock).mock.calls[0];
    expect(clip.samples).toHaveLength(28800);
    expect(clip.sampleRate).toBe(24000);
    expect(clip.duration).toBeCloseTo(1.2, 3);
  });

  it('marks the reply spoken only once the audio is on its way', async () => {
    withSpeaker(speechResult());
    const onPlaying = jest.fn();

    await speakWithModel('Salom', onPlaying);

    expect(onPlaying).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['generate', 'clear', 'play']);
  });

  it.each(['eos', 'max', 'aborted'])(
    'leaves no %s utterance state behind for the next text turn',
    async stopReason => {
      withSpeaker(speechResult({stopReason}));

      await speakWithModel('Salom');

      expect(clearCache).toHaveBeenCalledWith(true);
    },
  );

  it.each(['no-tts-template', 'unsupported'])(
    'does not disturb the cache or ask again after a %s refusal',
    async stopReason => {
      withSpeaker(
        speechResult({stopReason, pcm: new Float32Array(0), seconds: 0}),
      );

      const report = await speakWithModel('Salom');

      expect(clearCache).not.toHaveBeenCalled();
      expect(neuralAudioPlayer.play).not.toHaveBeenCalled();
      expect(report.spoken).toBe(false);
      expect(report.keepModelVoice).toBe(false);
    },
  );

  it('reports the stage and the engine words a native refusal left', async () => {
    withSpeaker(
      speechResult({
        stopReason: 'failed',
        stage: 'prompt-decode',
        error: 'llama_decode: no memory slot for batch of size 61',
        pcm: new Float32Array(0),
        seconds: 0,
        frames: 0,
      }),
    );

    const report = await speakWithModel('Salom');

    expect(report.stopReason).toBe('failed');
    expect(report.stage).toBe('prompt-decode');
    expect(report.error).toContain('no memory slot');
    expect(report.keepModelVoice).toBe(false);
  });

  it('names playback as the stage when the audio was refused after it was made', async () => {
    withSpeaker(speechResult());
    (neuralAudioPlayer.play as jest.Mock).mockRejectedValue(
      new Error('AudioTrack not ready'),
    );
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const report = await speakWithModel('Salom');

    expect(report.spoken).toBe(false);
    expect(report.stage).toBe('playback');
    expect(report.error).toBe('AudioTrack not ready');
    // The model did make the audio, so it is worth asking again next reply.
    expect(report.keepModelVoice).toBe(true);
    warn.mockRestore();
  });

  it('keeps the model voice for a reply that ran out of seconds', async () => {
    withSpeaker(speechResult({stopReason: 'max'}));

    const report = await speakWithModel('Salom');

    expect(report.spoken).toBe(true);
    expect(report.keepModelVoice).toBe(true);
  });

  it('does not play a half utterance the user interrupted', async () => {
    withSpeaker(speechResult({stopReason: 'aborted', aborted: true}));

    const report = await speakWithModel('Salom');

    expect(neuralAudioPlayer.play).not.toHaveBeenCalled();
    expect(report.spoken).toBe(false);
    expect(report.keepModelVoice).toBe(true);
  });

  it('gives up on a voice that costs more than four times what it says', async () => {
    withSpeaker(speechResult({genMs: 9000}));

    const report = await speakWithModel('Salom');

    expect(report.rtf).toBeCloseTo(4.5);
    expect(report.keepModelVoice).toBe(false);
    expect(neuralAudioPlayer.play).not.toHaveBeenCalled();
  });

  it('reports a generation that threw as a dead end', async () => {
    runInAction(() => {
      store.activeModelId = 'model-1';
      store.context = {id: nextId++, generateSpeech, clearCache, stopSpeech};
    });
    generateSpeech.mockRejectedValue(
      new Error('[RNLlama] Missing JSI bindings'),
    );
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const report = await speakWithModel('Salom');

    expect(report).toEqual(
      expect.objectContaining({spoken: false, keepModelVoice: false}),
    );
    expect(report.language).toBe('template');
    expect(clearCache).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('passes the debug language on, and nothing when the field is empty', async () => {
    withSpeaker(speechResult());

    await speakWithModel('Salom');
    expect(generateSpeech).toHaveBeenCalledWith(
      expect.not.objectContaining({language: expect.anything()}),
      undefined,
    );

    runInAction(() => {
      tts.speechLanguage = 'uzbek';
    });
    await speakWithModel('Salom');
    expect(generateSpeech).toHaveBeenLastCalledWith(
      {
        text: 'Salom',
        language: 'uzbek',
        maxSeconds: 30,
        // Every spoken reply asks for a sequence of its own: the alternative is
        // the next turn re-prefilling the whole conversation.
        isolateSeq: true,
      },
      undefined,
    );
  });

  it('names the template default when no language was set', async () => {
    withSpeaker(speechResult());

    const report = await speakWithModel('Salom');

    expect(report.language).toBe('template');
  });

  it('cuts both the frame loop and the audio', () => {
    withSpeaker(speechResult());

    stopModelSpeech();

    expect(stopSpeech).toHaveBeenCalledTimes(1);
    expect(neuralAudioPlayer.stop).toHaveBeenCalledTimes(1);
  });
});

/** One second of the model's own voice, and the pause between two of them. */
const RATE = 24000;
const talk = (ms: number) =>
  new Float32Array(Math.round((RATE * ms) / 1000)).fill(0.3);
const gap = (ms: number) => new Float32Array(Math.round((RATE * ms) / 1000));

/**
 * A streamed result carries no buffer — the samples went to the player instead
 * — so the pieces are what say there was audio at all.
 */
const streamedResult = (over: Record<string, unknown> = {}) =>
  speechResult({
    pcm: new Float32Array(0),
    chunks: 6,
    firstAudioMs: 900,
    ...over,
  });

describe('speakWithModel, piece by piece', () => {
  let generateSpeech: jest.Mock;
  let clearCache: jest.Mock;
  let stopSpeech: jest.Mock;
  const play = neuralAudioPlayer.play as jest.Mock;

  /** A context that speaks in pieces, handing each one to the callback. */
  const withStream = (
    result: Record<string, unknown>,
    pieces: Array<{samples: Float32Array; after?: number}>,
  ) => {
    runInAction(() => {
      store.activeModelId = 'model-1';
      store.context = {
        id: nextId++,
        generateSpeech,
        clearCache,
        stopSpeech,
        getMultimodalSupport: jest
          .fn()
          .mockResolvedValue({audioGen: true, audio: true}),
      };
    });
    generateSpeech.mockImplementation(async (_opts, onChunk) => {
      for (const piece of pieces) {
        onChunk(piece.samples, RATE);
        if (piece.after) {
          await new Promise(resolve => setTimeout(resolve, piece.after));
        }
      }
      return result;
    });
  };

  /** Two seconds of speech, cut by the feed into two pieces. */
  const twoPieces = [
    {samples: talk(900)},
    {samples: gap(120)},
    {samples: talk(900)},
    {samples: gap(120)},
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    generateSpeech = jest.fn();
    clearCache = jest.fn().mockResolvedValue(undefined);
    stopSpeech = jest.fn();
    play.mockResolvedValue(undefined);
    runInAction(() => {
      tts.streamSpeech = true;
      tts.speechLanguage = '';
      tts.forceTTSFallback = false;
    });
  });

  it('asks the engine for pieces and plays them all', async () => {
    withStream(streamedResult(), twoPieces);

    const report = await speakWithModel('Salom');

    expect(generateSpeech).toHaveBeenCalledWith(
      expect.objectContaining({stream: true}),
      expect.any(Function),
    );
    expect(play).toHaveBeenCalledTimes(2);
    expect(report).toEqual(
      expect.objectContaining({spoken: true, keepModelVoice: true}),
    );
  });

  it('says the reply is being heard as soon as a sample is on its way', async () => {
    withStream(streamedResult(), twoPieces);
    const onPlaying = jest.fn();

    await speakWithModel('Salom', onPlaying);

    expect(onPlaying).toHaveBeenCalledTimes(1);
  });

  it('starts playing before the engine has finished speaking', async () => {
    let heard = -1;
    runInAction(() => {
      store.activeModelId = 'model-1';
      store.context = {
        id: nextId++,
        clearCache,
        stopSpeech,
        getMultimodalSupport: jest
          .fn()
          .mockResolvedValue({audioGen: true, audio: true}),
        generateSpeech,
      };
    });
    generateSpeech.mockImplementation(async (_opts, onChunk) => {
      onChunk(talk(900), RATE);
      onChunk(gap(120), RATE);
      // A slice of wall clock, which is all the JS thread needs to take the
      // piece; the whole-buffer path could only have reported `0` here.
      await new Promise(resolve => setTimeout(resolve, 20));
      heard = play.mock.calls.length;
      onChunk(talk(900), RATE);
      onChunk(gap(120), RATE);
      return streamedResult();
    });

    const report = await speakWithModel('Salom');

    expect(heard).toBe(1);
    expect(play).toHaveBeenCalledTimes(2);
    expect(report.spoken).toBe(true);
  });

  it('clears the cache the utterance decoded over, pieces or not', async () => {
    withStream(streamedResult(), twoPieces);

    await speakWithModel('Salom');

    expect(clearCache).toHaveBeenCalledWith(true);
  });

  it('leaves a reply with no piece to the TTS voice', async () => {
    withStream(
      streamedResult({
        chunks: 0,
        seconds: 0,
        genMs: 0,
        stopReason: 'unsupported',
        stage: 'no-audio-gen',
      }),
      [],
    );

    const report = await speakWithModel('Salom');

    expect(report).toEqual(
      expect.objectContaining({spoken: false, keepModelVoice: false}),
    );
    expect(play).not.toHaveBeenCalled();
  });

  it('plays the one buffer a build that ignored the stream flag hands back', async () => {
    // The flag was sent and the engine answered with a whole clip instead of
    // pieces. The audio exists, so it is heard: discarding it because it did not
    // arrive the way the setting asked is how a reply ends up silent.
    withStream(
      streamedResult({chunks: 0, pcm: new Float32Array(48000).fill(0.25)}),
      [],
    );

    const report = await speakWithModel('Salom');

    expect(play).toHaveBeenCalled();
    expect(report).toEqual(
      expect.objectContaining({spoken: true, keepModelVoice: true}),
    );
  });

  it('drops the pieces a barge-in did not live to hear', async () => {
    let release: () => void = () => {};
    runInAction(() => {
      store.activeModelId = 'model-1';
      store.context = {
        id: nextId++,
        clearCache,
        stopSpeech,
        getMultimodalSupport: jest
          .fn()
          .mockResolvedValue({audioGen: true, audio: true}),
        generateSpeech,
      };
    });
    generateSpeech.mockImplementation(async (_opts, onChunk) => {
      onChunk(talk(900), RATE);
      onChunk(gap(120), RATE);
      await new Promise(resolve => {
        release = () => resolve(undefined);
      });
      // The engine notices the interrupt between batches and says so here.
      onChunk(talk(900), RATE);
      return streamedResult({stopReason: 'aborted', aborted: true});
    });

    const pending = speakWithModel('Salom');
    await new Promise(resolve => setTimeout(resolve, 20));
    stopModelSpeech();
    release();
    const report = await pending;

    expect(stopSpeech).toHaveBeenCalledTimes(1);
    expect(neuralAudioPlayer.stop).toHaveBeenCalled();
    expect(play).toHaveBeenCalledTimes(1);
    expect(report.spoken).toBe(false);
  });

  it('plays the tail however short it is', async () => {
    withStream(streamedResult(), [{samples: talk(400)}]);

    const report = await speakWithModel('Salom');

    expect(play).toHaveBeenCalledTimes(1);
    expect(play.mock.calls[0][0].duration).toBeCloseTo(0.4, 3);
    expect(report.spoken).toBe(true);
  });
});

/**
 * The slot an utterance is asked to sit on. Asking for a second one is what
 * `speechKeepCache` means; a context built with one has nowhere to put it.
 */
describe('canIsolateSpeechSeq', () => {
  it('needs the slot it is asking for', () => {
    expect(canIsolateSpeechSeq(undefined)).toBe(false);
    expect(canIsolateSpeechSeq(1)).toBe(false);
    expect(canIsolateSpeechSeq(2)).toBe(true);
  });
});

/**
 * The conversation cache. Asking for a sequence of its own is one thing; a
 * bridge that has no such option answers without saying it isolated anything,
 * and then the cache was touched all the same — so the clear is decided by what
 * came back, not by what was asked for.
 */
describe('the cache a spoken reply leaves behind', () => {
  const calls: string[] = [];
  let generateSpeech: jest.Mock;
  let clearCache: jest.Mock;

  const speaker = (result: Record<string, unknown>) => {
    runInAction(() => {
      store.activeModelId = 'model-1';
      store.context = {
        id: nextId++,
        generateSpeech,
        clearCache,
        stopSpeech: jest.fn(),
        getMultimodalSupport: jest
          .fn()
          .mockResolvedValue({audioGen: true, audio: true}),
      };
    });
    generateSpeech.mockImplementation(async () => {
      calls.push('generate');
      return result;
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    calls.length = 0;
    generateSpeech = jest.fn();
    clearCache = jest.fn().mockResolvedValue(undefined);
    runInAction(() => {
      tts.streamSpeech = false;
      tts.speechLanguage = '';
      tts.forceTTSFallback = false;
      tts.speechKeepCache = true;
      store.contextInitParams = {...store.contextInitParams, n_parallel: 2};
    });
  });

  it('asks the engine to speak on a sequence of its own', async () => {
    speaker(speechResult());

    await speakWithModel('Salom');

    expect(generateSpeech).toHaveBeenCalledWith(
      expect.objectContaining({isolateSeq: true}),
      undefined,
    );
  });

  it('asks for the old shared positions when the setting is off', async () => {
    runInAction(() => {
      tts.speechKeepCache = false;
    });
    speaker(speechResult());

    await speakWithModel('Salom');

    expect(generateSpeech.mock.calls[0][0]).not.toHaveProperty('isolateSeq');
  });

  it('asks for the shared positions when the context has one slot', async () => {
    // The phone that started this: `n_seq_max = 1`. Asking is not a preference
    // the engine can decline here — the prefill fails, no sample is made, and
    // the dead end takes the model's voice away from every later reply.
    runInAction(() => {
      store.contextInitParams = {...store.contextInitParams, n_parallel: 1};
    });
    speaker(speechResult());

    await speakWithModel('Salom');

    expect(generateSpeech.mock.calls[0][0]).not.toHaveProperty('isolateSeq');
  });

  it('pays the cache back from the conversation when it had to sit on it', async () => {
    runInAction(() => {
      store.contextInitParams = {...store.contextInitParams, n_parallel: 1};
    });
    speaker(speechResult());

    const report = await speakWithModel('Salom');

    expect(clearCache).toHaveBeenCalledWith(true);
    expect(report.cacheKept).toBe(false);
  });

  it('leaves the cache standing when the engine says it took the utterance back', async () => {
    speaker(speechResult({seqIsolated: true}));

    const report = await speakWithModel('Salom');

    expect(clearCache).not.toHaveBeenCalled();
    expect(report.cacheKept).toBe(true);
    expect(report.spoken).toBe(true);
  });

  it('clears what it did after a build that answered without the flag', async () => {
    speaker(speechResult({seqIsolated: false}));

    const report = await speakWithModel('Salom');

    expect(clearCache).toHaveBeenCalledWith(true);
    expect(report.cacheKept).toBe(false);
  });
});

/**
 * The two safety limits are invisible in the engine's own words: a reply that
 * ran out of time and a reply that finished both say `max`/`eos`. The report has
 * to name which one gave up, because that is what the next setting is chosen
 * against.
 */
describe('the limit a reply was dropped on', () => {
  let generateSpeech: jest.Mock;
  let clearCache: jest.Mock;

  const speaker = (result: Record<string, unknown>) => {
    runInAction(() => {
      store.activeModelId = 'model-1';
      store.context = {
        id: nextId++,
        generateSpeech,
        clearCache,
        stopSpeech: jest.fn(),
        getMultimodalSupport: jest
          .fn()
          .mockResolvedValue({audioGen: true, audio: true}),
      };
    });
    generateSpeech.mockImplementation(async () => result);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    generateSpeech = jest.fn();
    clearCache = jest.fn().mockResolvedValue(undefined);
    (neuralAudioPlayer.play as jest.Mock).mockResolvedValue(undefined);
    runInAction(() => {
      tts.streamSpeech = false;
      tts.speechLanguage = '';
      tts.forceTTSFallback = false;
      tts.speechKeepCache = true;
    });
  });

  it('names the real-time factor when generating outran the audio', async () => {
    speaker(
      speechResult({
        genMs: (MAX_REALTIME_FACTOR + 1) * 2000,
        seconds: 2,
      }),
    );

    const report = await speakWithModel('Salom');

    expect(report.drop).toBe('rtf');
    expect(report.keepModelVoice).toBe(false);
    expect(neuralAudioPlayer.play).not.toHaveBeenCalled();
  });

  it('names the length limit a reply ran into', async () => {
    speaker(
      speechResult({
        seconds: MAX_UTTERANCE_SECONDS,
        genMs: 2000,
        stopReason: 'max',
        stage: 'max-seconds',
        pcm: new Float32Array(24000 * MAX_UTTERANCE_SECONDS).fill(0.2),
      }),
    );

    const report = await speakWithModel('Salom');

    expect(report.drop).toBe('time');
    // Long is not the same as impossible: what it did say is still worth hearing.
    expect(report.keepModelVoice).toBe(true);
    expect(neuralAudioPlayer.play).toHaveBeenCalledTimes(1);
  });

  it('says a reply that made no audio at all', async () => {
    speaker(
      speechResult({
        seconds: 0,
        frames: 0,
        genMs: 500,
        pcm: new Float32Array(0),
      }),
    );

    const report = await speakWithModel('Salom');

    expect(report.drop).toBe('no-audio');
    expect(report.spoken).toBe(false);
  });

  it('leaves a reply that simply finished alone', async () => {
    speaker(speechResult({seqIsolated: true}));

    const report = await speakWithModel('Salom');

    expect(report.drop).toBe('none');
  });
});

/**
 * The warm-up. It spends the one-time cost of a context at the moment nobody is
 * waiting, so it must happen once per context, must not be asked of a model that
 * has no voice, and must not leave the conversation cache it decoded over.
 */
describe('prewarmSpeech', () => {
  let generateSpeech: jest.Mock;
  let clearCache: jest.Mock;
  let stopSpeech: jest.Mock;

  const warmable = () => {
    runInAction(() => {
      store.activeModelId = 'model-1';
      store.context = {
        id: nextId++,
        generateSpeech,
        clearCache,
        stopSpeech,
        getMultimodalSupport: jest
          .fn()
          .mockResolvedValue({audioGen: true, audio: true}),
      };
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    generateSpeech = jest.fn();
    clearCache = jest.fn().mockResolvedValue(undefined);
    stopSpeech = jest.fn();
    runInAction(() => {
      tts.speechKeepCache = true;
      tts.forceTTSFallback = false;
      store.contextInitParams = {...store.contextInitParams, n_parallel: 2};
    });
  });

  it('voices one syllable, once per context, and stops it as it lands', async () => {
    warmable();
    generateSpeech.mockImplementation(async (_opts, onChunk) => {
      onChunk(new Float32Array(2400), 24000);
      return speechResult({stopReason: 'aborted', aborted: true});
    });

    await prewarmSpeech();
    await prewarmSpeech();

    expect(generateSpeech).toHaveBeenCalledTimes(1);
    expect(generateSpeech.mock.calls[0][0]).toEqual(
      expect.objectContaining({text: 'Aa.', maxSeconds: 1, isolateSeq: true}),
    );
    expect(stopSpeech).toHaveBeenCalledTimes(1);
  });

  it('warms the pipeline it can actually use on a one-slot context', async () => {
    // The syllable that failed on the phone is the one the session opens with:
    // asked for a sequence the context does not have, it never built the
    // speech generator, and the first real reply paid for it and failed too.
    runInAction(() => {
      store.contextInitParams = {...store.contextInitParams, n_parallel: 1};
    });
    warmable();
    generateSpeech.mockImplementation(async (_opts, onChunk) => {
      onChunk(new Float32Array(2400), 24000);
      return speechResult({stopReason: 'aborted', aborted: true});
    });

    await prewarmSpeech();

    expect(generateSpeech.mock.calls[0][0]).not.toHaveProperty('isolateSeq');
  });

  it('owes the next turn a clear when it decoded over their positions', async () => {
    warmable();
    generateSpeech.mockImplementation(async (_opts, onChunk) => {
      onChunk(new Float32Array(2400), 24000);
      return speechResult({stopReason: 'aborted', aborted: true});
    });

    await prewarmSpeech();

    expect(clearCache).toHaveBeenCalledWith(true);
  });

  it('leaves the cache alone when the engine took its own sequence back', async () => {
    warmable();
    generateSpeech.mockImplementation(async () =>
      speechResult({stopReason: 'aborted', aborted: true, seqIsolated: true}),
    );

    await prewarmSpeech();

    expect(clearCache).not.toHaveBeenCalled();
  });

  it('does not ask a model that has no voice', async () => {
    runInAction(() => {
      store.activeModelId = 'model-1';
      store.context = {
        id: nextId++,
        generateSpeech,
        clearCache,
        stopSpeech,
        getMultimodalSupport: jest
          .fn()
          .mockResolvedValue({audioGen: false, audio: true}),
      };
    });

    await prewarmSpeech();

    expect(generateSpeech).not.toHaveBeenCalled();
  });

  it('asks again after a warm-up that threw, because nothing was learned', async () => {
    warmable();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    generateSpeech.mockRejectedValue(new Error('native refused'));

    await prewarmSpeech();
    generateSpeech.mockImplementation(async () => speechResult());
    await prewarmSpeech();

    expect(generateSpeech).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

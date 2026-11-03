import {runInAction} from 'mobx';

import {neuralAudioPlayer} from '@pocketpalai/react-native-speech/engine-sdk';

import {modelStore, ttsStore} from '../../../store';
import {ModelOrigin} from '../../../utils/types';

import {
  modelCanVoiceReplies,
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
    );

    runInAction(() => {
      tts.speechLanguage = 'uzbek';
    });
    await speakWithModel('Salom');
    expect(generateSpeech).toHaveBeenLastCalledWith({
      text: 'Salom',
      language: 'uzbek',
      maxSeconds: 30,
    });
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

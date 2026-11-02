import {runInAction} from 'mobx';

import {modelStore, ttsStore} from '../../../store';
import {ModelOrigin} from '../../../utils/types';

import {modelCanVoiceReplies} from '../omniSpeech';

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

describe('modelCanVoiceReplies', () => {
  beforeEach(() => {
    runInAction(() => {
      store.models = [];
      store.activeModelId = undefined;
      store.context = undefined;
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

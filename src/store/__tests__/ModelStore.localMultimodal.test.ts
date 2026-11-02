jest.unmock('../../store');

import * as RNFS from '@dr.pogodin/react-native-fs';
import {runInAction} from 'mobx';

import {basicModel} from '../../../jest/fixtures/models';
import {modelStore} from '..';
import {Model, ModelOrigin, ModelType} from '../../utils/types';

const DIR = '/documents/models/local';
const MODEL_NAME = 'LFM3-Omni-2B-Q8_0.gguf';
const PROJ_NAME = 'mmproj-LFM3-Omni-2B-Q8_0.gguf';
const MODEL_PATH = `${DIR}/${MODEL_NAME}`;
const PROJ_PATH = `${DIR}/${PROJ_NAME}`;

const unpairedLocalModel = (): Model => ({
  ...basicModel,
  id: 'local-omni',
  name: 'LFM3-Omni-2B-Q8_0',
  filename: MODEL_NAME,
  isLocal: true,
  origin: ModelOrigin.LOCAL,
  fullPath: MODEL_PATH,
  isDownloaded: true,
  supportsMultimodal: undefined,
  modelType: undefined,
  capabilities: undefined,
  compatibleProjectionModels: undefined,
  defaultProjectionModel: undefined,
  visionEnabled: undefined,
});

const push = (model: Model): Model => {
  runInAction(() => {
    modelStore.models.push(model);
  });
  // The observable proxy, not the plain literal — mutations on the literal
  // would bypass MobX and the store would read stale fields back.
  return modelStore.models.find(m => m.id === model.id)!;
};

describe('ModelStore local projector pairing', () => {
  const resolve = (target: Model) =>
    (modelStore as any).resolveMultimodalConfig(target);

  let model: Model;
  let addLocalModel: jest.Mock;

  // A context that already runs the model, so the only thing left to ask for
  // is the projector on top of it.
  const contextWithProjector = () => {
    const ctx = {
      initMultimodal: jest.fn().mockResolvedValue(true),
      isMultimodalEnabled: jest.fn().mockResolvedValue(true),
      getMultimodalSupport: jest
        .fn()
        .mockResolvedValue({vision: true, audio: true}),
      completion: jest.fn().mockResolvedValue({text: 'a cat'}),
      stopCompletion: jest.fn(),
    };
    runInAction(() => {
      modelStore.context = ctx as any;
      modelStore.activeModelId = model.id;
    });
    return ctx;
  };

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'log').mockImplementation();

    runInAction(() => {
      modelStore.models = [];
      modelStore.context = undefined;
      modelStore.isMultimodalActive = false;
      modelStore.activeModelId = undefined;
      modelStore.activeProjectionModelId = undefined;
      modelStore.projectionGap = {kind: 'none'};
    });
    model = push(unpairedLocalModel());

    (RNFS.readDir as jest.Mock).mockReset();
    (RNFS.readDir as jest.Mock).mockResolvedValue([
      {name: MODEL_NAME},
      {name: PROJ_NAME},
    ]);
    (RNFS.stat as jest.Mock).mockReset();
    (RNFS.stat as jest.Mock).mockResolvedValue({size: 500e6});

    // Register the file the way addLocalModel would, without the GGUF header
    // read that has nothing to do with pairing.
    addLocalModel = jest.fn(async (fullPath: string) => {
      push({
        ...basicModel,
        id: `local-${fullPath}`,
        name: fullPath.split('/').pop()!,
        filename: fullPath.split('/').pop()!,
        isLocal: true,
        origin: ModelOrigin.LOCAL,
        fullPath,
        isDownloaded: true,
      });
    });
    (modelStore as any).addLocalModel = addLocalModel;
  });

  describe('linkLocalProjectionModels', () => {
    it('reads the projector out of the folder the weights live in', async () => {
      const ids = await modelStore.linkLocalProjectionModels(model);

      expect(ids).toHaveLength(1);
      expect(model.supportsMultimodal).toBe(true);
      expect(model.modelType).toBe(ModelType.VISION);
      expect(model.capabilities).toEqual(['vision']);
      expect(model.defaultProjectionModel).toBe(ids[0]);
      expect(
        modelStore.models.find(m => m.id === model.defaultProjectionModel)!,
      ).toMatchObject({fullPath: PROJ_PATH});
    });

    it('hides the projector behind the model that owns it', async () => {
      const ids = await modelStore.linkLocalProjectionModels(model);

      const projection = modelStore.models.find(m => m.id === ids[0])!;
      expect(projection.modelType).toBe(ModelType.PROJECTION);
    });

    it('pairs nothing when the folder holds no projector', async () => {
      (RNFS.readDir as jest.Mock).mockResolvedValue([{name: MODEL_NAME}]);

      await expect(
        modelStore.linkLocalProjectionModels(model),
      ).resolves.toEqual([]);
      expect(model.supportsMultimodal).toBeUndefined();
      expect(addLocalModel).not.toHaveBeenCalled();
    });

    it('leaves a foreign-family projector alone in a shared folder', async () => {
      (RNFS.readDir as jest.Mock).mockResolvedValue([
        {name: MODEL_NAME},
        {name: 'gemma-3n-e4b-it-f16.gguf'},
        {name: 'mmproj-gemma-3n-e4b-it-f16.gguf'},
      ]);

      await expect(
        modelStore.linkLocalProjectionModels(model),
      ).resolves.toEqual([]);
      expect(model.supportsMultimodal).toBeUndefined();
    });

    it('is idempotent — a paired model keeps one projector of each name', async () => {
      const first = await modelStore.linkLocalProjectionModels(model);
      const again = await modelStore.linkLocalProjectionModels(model);

      expect(again).toEqual([]);
      expect(first).toHaveLength(1);
      expect(addLocalModel).toHaveBeenCalledTimes(1);
      expect(
        modelStore.models.filter(m => m.fullPath === PROJ_PATH),
      ).toHaveLength(1);
    });

    it('skips drafts and projection files, which own nothing', async () => {
      const draft = push({
        ...unpairedLocalModel(),
        id: 'local-draft',
        filename: 'LFM3-Omni-2B-Q8_0-draft.gguf',
        fullPath: `${DIR}/LFM3-Omni-2B-Q8_0-draft.gguf`,
      });
      const projector = push({
        ...unpairedLocalModel(),
        id: 'local-projector',
        filename: PROJ_NAME,
        fullPath: PROJ_PATH,
      });

      await expect(
        modelStore.linkLocalProjectionModels(draft),
      ).resolves.toEqual([]);
      await expect(
        modelStore.linkLocalProjectionModels(projector),
      ).resolves.toEqual([]);
      expect(addLocalModel).not.toHaveBeenCalled();
    });

    it('does not touch a model that came from Hugging Face', async () => {
      const hfModel = push({
        ...unpairedLocalModel(),
        id: 'hf-model',
        isLocal: false,
        origin: ModelOrigin.HF,
        fullPath: undefined,
      });

      await expect(
        modelStore.linkLocalProjectionModels(hfModel),
      ).resolves.toEqual([]);
      expect(RNFS.readDir).not.toHaveBeenCalled();
    });
  });

  describe('healLocalProjectionLinks', () => {
    it('pairs an import that predates the folder scan', async () => {
      await modelStore.healLocalProjectionLinks();

      expect(model.supportsMultimodal).toBe(true);
      expect(model.defaultProjectionModel).toBeDefined();
    });

    it('leaves an already paired model alone', async () => {
      await modelStore.linkLocalProjectionModels(model);
      addLocalModel.mockClear();

      await modelStore.healLocalProjectionLinks();

      expect(addLocalModel).not.toHaveBeenCalled();
    });
  });

  describe('resolveMultimodalConfig', () => {
    it('pairs on the fly when the load path asks', async () => {
      (modelStore as any).addLocalModel = jest.fn(async (fullPath: string) => {
        push({
          ...basicModel,
          id: `local-${fullPath}`,
          filename: fullPath.split('/').pop()!,
          isLocal: true,
          origin: ModelOrigin.LOCAL,
          fullPath,
          isDownloaded: true,
        });
      });

      await expect(resolve(model)).resolves.toMatchObject({
        isMultimodalInit: true,
        resolvedMmProjPath: PROJ_PATH,
      });
    });

    it('settles for a projector the quant match did not pick', async () => {
      await modelStore.linkLocalProjectionModels(model);
      const paired = modelStore.models.find(
        m => m.id === model.defaultProjectionModel,
      )!;
      const other = push({
        ...unpairedLocalModel(),
        id: 'local-other-projector',
        filename: 'mmproj-LFM3-Omni-2B-Q4_0.gguf',
        fullPath: `${DIR}/mmproj-LFM3-Omni-2B-Q4_0.gguf`,
        modelType: ModelType.PROJECTION,
      });
      runInAction(() => {
        paired.isDownloaded = false;
        model.defaultProjectionModel = paired.id;
        model.compatibleProjectionModels = [paired.id, other.id];
      });

      await expect(resolve(model)).resolves.toMatchObject({
        isMultimodalInit: true,
        resolvedMmProjPath: other.fullPath,
      });
    });

    it('stays off when the projector was turned off by hand', async () => {
      await modelStore.linkLocalProjectionModels(model);
      runInAction(() => {
        model.visionEnabled = false;
      });

      await expect(resolve(model)).resolves.toEqual({
        isMultimodalInit: false,
        gap: {kind: 'none'},
      });
    });
  });

  // The media turn that degrades to text is silent unless the store can name
  // what is missing, so each way of missing it has to land in `projectionGap`.
  describe('projectionGap', () => {
    it('names the projector the library knows but the phone does not hold', async () => {
      await modelStore.linkLocalProjectionModels(model);
      const paired = modelStore.models.find(
        m => m.id === model.defaultProjectionModel,
      )!;
      runInAction(() => {
        paired.isDownloaded = false;
      });

      await expect(resolve(model)).resolves.toMatchObject({
        isMultimodalInit: false,
        gap: {kind: 'download', filename: PROJ_NAME},
      });
      expect(modelStore.projectionGap).toEqual({
        kind: 'download',
        filename: PROJ_NAME,
      });
    });

    it('says the folder is short when an import has no mmproj beside it', async () => {
      (RNFS.readDir as jest.Mock).mockResolvedValue([{name: MODEL_NAME}]);

      await expect(resolve(model)).resolves.toMatchObject({
        gap: {kind: 'folder'},
      });
    });

    it('stays quiet about a model that never claimed vision', async () => {
      const textOnly = push({
        ...unpairedLocalModel(),
        id: 'local-text',
        fullPath: undefined,
      });

      await expect(resolve(textOnly)).resolves.toMatchObject({
        gap: {kind: 'none'},
      });
    });

    it('blames the file the engine refused', async () => {
      const ctx = {
        initMultimodal: jest.fn().mockResolvedValue(false),
        isMultimodalEnabled: jest.fn().mockResolvedValue(false),
      };
      runInAction(() => {
        modelStore.context = ctx as any;
        modelStore.activeModelId = model.id;
      });

      await expect(modelStore.ensureMultimodalActive()).resolves.toBe(false);
      expect(modelStore.projectionGap).toEqual({
        kind: 'attach',
        filename: PROJ_NAME,
      });
    });

    it('clears once a projector is attached', async () => {
      const ctx = {
        initMultimodal: jest.fn().mockResolvedValue(true),
        isMultimodalEnabled: jest.fn().mockResolvedValue(true),
      };
      runInAction(() => {
        modelStore.context = ctx as any;
        modelStore.activeModelId = model.id;
        modelStore.projectionGap = {kind: 'folder'};
      });

      await expect(modelStore.ensureMultimodalActive()).resolves.toBe(true);
      expect(modelStore.projectionGap).toEqual({kind: 'none'});
    });

    // A projector is weights on top of the model that is already running, and
    // the kill for asking too much is silent — so it is refused, not attempted.
    it('refuses a projector larger than the memory the phone has', async () => {
      const ctx = contextWithProjector();
      (RNFS.stat as jest.Mock).mockResolvedValue({size: 4e9});

      await expect(modelStore.ensureMultimodalActive()).resolves.toBe(false);
      expect(ctx.initMultimodal).not.toHaveBeenCalled();
      expect(modelStore.projectionGap).toEqual({
        kind: 'noRam',
        filename: PROJ_NAME,
      });
    });

    it('loads one that fits inside what is free', async () => {
      const ctx = contextWithProjector();
      (RNFS.stat as jest.Mock).mockResolvedValue({size: 500e6});

      await expect(modelStore.ensureMultimodalActive()).resolves.toBe(true);
      expect(ctx.initMultimodal).toHaveBeenCalledWith(
        expect.objectContaining({path: PROJ_PATH}),
      );
    });

    it('does not refuse on a size it could not read', async () => {
      const ctx = contextWithProjector();
      (RNFS.stat as jest.Mock).mockRejectedValue(new Error('unreadable'));

      await expect(modelStore.ensureMultimodalActive()).resolves.toBe(true);
      expect(ctx.initMultimodal).toHaveBeenCalled();
    });
  });

  describe('ensureMultimodalActive', () => {
    it('puts the projector on the context that is already running', async () => {
      const ctx = contextWithProjector();

      await expect(modelStore.ensureMultimodalActive()).resolves.toBe(true);
      expect(ctx.initMultimodal).toHaveBeenCalledWith(
        expect.objectContaining({path: PROJ_PATH}),
      );
      expect(modelStore.isMultimodalActive).toBe(true);
      expect(modelStore.activeProjectionModelId).toBe(
        model.defaultProjectionModel,
      );
    });

    it('says no when there is no context to attach to', async () => {
      await modelStore.linkLocalProjectionModels(model);

      await expect(modelStore.ensureMultimodalActive()).resolves.toBe(false);
      expect(modelStore.isMultimodalActive).toBe(false);
    });

    it('says no when the engine refuses the projector', async () => {
      const ctx = contextWithProjector();
      ctx.initMultimodal.mockResolvedValue(false);

      await expect(modelStore.ensureMultimodalActive()).resolves.toBe(false);
      expect(modelStore.isMultimodalActive).toBe(false);
    });

    it('keeps a projector that is already attached', async () => {
      const ctx = contextWithProjector();
      runInAction(() => {
        modelStore.isMultimodalActive = true;
      });

      await expect(modelStore.ensureMultimodalActive()).resolves.toBe(true);
      expect(ctx.initMultimodal).not.toHaveBeenCalled();
    });

    it('lets an image turn recover instead of throwing', async () => {
      const ctx = contextWithProjector();
      const onComplete = jest.fn();

      await modelStore.startImageCompletion({
        prompt: 'What is this?',
        image_paths: [`${DIR}/frame.jpg`],
        onComplete,
      });

      expect(ctx.initMultimodal).toHaveBeenCalledWith(
        expect.objectContaining({path: PROJ_PATH}),
      );
      expect(ctx.completion).toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalledWith('a cat');
    });

    it('names the missing projector when a turn cannot be served', async () => {
      (RNFS.readDir as jest.Mock).mockResolvedValue([{name: MODEL_NAME}]);
      contextWithProjector();

      await expect(
        modelStore.startImageCompletion({
          prompt: 'What is this?',
          image_paths: [`${DIR}/frame.jpg`],
        }),
      ).rejects.toThrow('no projection model (mmproj) is loaded');
    });
  });
});

jest.unmock('../../store');

// The store kicks a device-signal read off at construction; unmocked it reads
// Platform after the environment is gone and jest fails the file for a log.
jest.mock('../../services/deviceRules/rules', () => ({
  fetchRules: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../services/deviceRules/signals', () => ({
  readDeviceSignals: jest
    .fn()
    .mockResolvedValue({ramBytes: 8 * 1e9, socModel: 'SM8850'}),
}));
// Only the two calls this suite steers are mocked; the rest of the module stays
// real so that stores imported alongside do not lose their own API functions.
jest.mock('../../api/hf', () => ({
  ...jest.requireActual('../../api/hf'),
  fetchModels: jest.fn(),
  fetchModelFilesDetails: jest.fn(),
}));
jest.mock('../../services/downloads', () => {
  class MockDownloadCancelledError extends Error {
    modelId: string;
    constructor(modelId: string) {
      super(`Download cancelled for ${modelId}`);
      this.name = 'DownloadCancelledError';
      this.modelId = modelId;
    }
  }
  return {
    DownloadCancelledError: MockDownloadCancelledError,
    downloadManager: {
      isDownloading: jest.fn(),
      startDownload: jest.fn(),
      cancelDownload: jest.fn(),
      setCallbacks: jest.fn(),
      syncWithActiveDownloads: jest.fn().mockResolvedValue(undefined),
    },
  };
});

import {runInAction} from 'mobx';

import {basicModel} from '../../../jest/fixtures/models';
import {modelStore} from '..';
import {fetchModelFilesDetails, fetchModels} from '../../api/hf';
import {Model, ModelOrigin, ModelType} from '../../utils/types';

const REPO = 'LiquidAI/LFM3-2.6-omni-gguf';
const MODEL_NAME = 'LFM3-Omni-2B-Q8_0.gguf';
const PROJ_Q8 = 'mmproj-LFM3-Omni-2B-Q8_0.gguf';
const PROJ_Q4 = 'mmproj-LFM3-Omni-2B-Q4_0.gguf';

const hubFile = (path: string, size = 400e6) => ({
  type: 'file',
  oid: `oid-${path}`,
  size,
  path,
});

const repoFiles = (paths: string[]) => paths.map(path => hubFile(path));

const searchHits = (ids: string[]) =>
  (fetchModels as jest.Mock).mockResolvedValue({
    models: ids.map(id => ({
      _id: id,
      id,
      author: id.split('/')[0],
      lastModified: '2026-01-01',
      likes: 10,
      downloads: 1000,
      tags: ['gguf'],
      siblings: [],
    })),
    nextLink: null,
  });

describe('ModelStore projector search on the Hub', () => {
  let model: Model;
  let downloadSpy: jest.Mock;

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'log').mockImplementation();
    jest.clearAllMocks();

    runInAction(() => {
      modelStore.models = [];
    });
    runInAction(() => {
      modelStore.models.push({
        ...basicModel,
        id: 'local-omni',
        name: MODEL_NAME,
        filename: MODEL_NAME,
        isLocal: true,
        origin: ModelOrigin.LOCAL,
        fullPath: `/documents/models/local/${MODEL_NAME}`,
        isDownloaded: true,
        supportsMultimodal: undefined,
        modelType: undefined,
        compatibleProjectionModels: undefined,
        defaultProjectionModel: undefined,
      });
    });
    model = modelStore.models.find(m => m.id === 'local-omni')!;

    // The download itself belongs to the manager; this suite is about which
    // file gets asked for. The store wraps a method back into an action when
    // it is reassigned, so the handle, not the property, is what the
    // assertions read.
    downloadSpy = jest.fn().mockResolvedValue(undefined);
    (modelStore as any).downloadProjectionModel = downloadSpy;
  });

  describe('findProjectionFileInHub', () => {
    it('searches by the model name with its quant left off', async () => {
      searchHits([REPO]);
      (fetchModelFilesDetails as jest.Mock).mockResolvedValue(
        repoFiles([MODEL_NAME, PROJ_Q8]),
      );

      await modelStore.findProjectionFileInHub('LFM3-Omni-2B-Q8_0.gguf');

      expect(fetchModels).toHaveBeenCalledWith(
        expect.objectContaining({search: 'LFM3-Omni-2B', filter: 'gguf'}),
      );
    });

    it('takes the Q8_0 projector when the repository carries several', async () => {
      searchHits([REPO]);
      (fetchModelFilesDetails as jest.Mock).mockResolvedValue(
        repoFiles(['LFM3-Omni-2B-Q4_K_M.gguf', MODEL_NAME, PROJ_Q4, PROJ_Q8]),
      );

      const found = await modelStore.findProjectionFileInHub(MODEL_NAME);

      expect(found?.modelFile.rfilename).toBe(PROJ_Q8);
      expect(found?.modelFile.url).toContain(`${REPO}/resolve/main/${PROJ_Q8}`);
      // The row the card builds later reads its pairing off these fields.
      expect(found?.hfModel.siblings.map(f => f.rfilename)).toContain(PROJ_Q8);
    });

    it('keeps its distance from a projector named for another model', async () => {
      searchHits([REPO]);
      (fetchModelFilesDetails as jest.Mock).mockResolvedValue(
        repoFiles([
          'LFM3-Omni-2B-Q4_K_M.gguf',
          MODEL_NAME,
          'mmproj-Qwen2-VL-7B-f16.gguf',
        ]),
      );

      await expect(
        modelStore.findProjectionFileInHub(MODEL_NAME),
      ).resolves.toBe(undefined);
    });

    it('walks past a repository whose listing fails', async () => {
      searchHits(['a/empty-repo', REPO]);
      (fetchModelFilesDetails as jest.Mock)
        .mockRejectedValueOnce(new Error('403'))
        .mockResolvedValueOnce(repoFiles([MODEL_NAME, PROJ_Q8]));

      const found = await modelStore.findProjectionFileInHub(MODEL_NAME);

      expect(found?.hfModel.id).toBe(REPO);
    });

    it('asks nothing of the Hub for a file that names no model', async () => {
      await expect(
        modelStore.findProjectionFileInHub('model-Q4_K_M.gguf'),
      ).resolves.toBeUndefined();

      expect(fetchModels).not.toHaveBeenCalled();
    });
  });

  describe('autoFetchProjectionModel', () => {
    beforeEach(() => {
      searchHits([REPO]);
      (fetchModelFilesDetails as jest.Mock).mockResolvedValue(
        repoFiles([MODEL_NAME, PROJ_Q4, PROJ_Q8]),
      );
    });

    it('registers the projector and points the imported model at it', async () => {
      const projector = await modelStore.autoFetchProjectionModel(model.id);

      const projectorId = `${REPO}/${PROJ_Q8}`;
      expect(projector?.id).toBe(projectorId);
      expect(projector?.modelType).toBe(ModelType.PROJECTION);
      expect(projector?.downloadUrl).toContain('resolve/main');
      expect(model.defaultProjectionModel).toBe(projectorId);
      expect(model.compatibleProjectionModels).toEqual([projectorId]);
      expect(model.supportsMultimodal).toBe(true);
      expect(downloadSpy).toHaveBeenCalledWith(projectorId);
    });

    it('adds one row per projector file', async () => {
      await modelStore.autoFetchProjectionModel(model.id);
      await modelStore.autoFetchProjectionModel(model.id);

      expect(
        modelStore.models.filter(m => m.modelType === ModelType.PROJECTION),
      ).toHaveLength(1);
    });

    it('changes nothing when the Hub has nothing to offer', async () => {
      (fetchModelFilesDetails as jest.Mock).mockResolvedValue(
        repoFiles([
          'Other-Model-Q4_K_M.gguf',
          'Another-Model-Q8_0.gguf',
          'mmproj-Something-Else-f16.gguf',
        ]),
      );

      await expect(
        modelStore.autoFetchProjectionModel(model.id),
      ).resolves.toBeUndefined();

      expect(modelStore.models).toHaveLength(1);
      expect(model.supportsMultimodal).toBeUndefined();
      expect(model.defaultProjectionModel).toBeUndefined();
      expect(downloadSpy).not.toHaveBeenCalled();
    });

    it('never looks a projector up for a projector', async () => {
      await expect(
        modelStore.autoFetchProjectionModel(`${REPO}/${PROJ_Q8}`),
      ).resolves.toBeUndefined();

      expect(fetchModels).not.toHaveBeenCalled();
    });
  });
});

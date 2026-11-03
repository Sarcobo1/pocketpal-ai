jest.unmock('../../store');

jest.mock('../../services/deviceRules/rules', () => ({
  fetchRules: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../services/deviceRules/signals', () => ({
  readDeviceSignals: jest
    .fn()
    .mockResolvedValue({ramBytes: 8 * 1e9, socModel: 'SM8850'}),
}));

import * as RNFS from '@dr.pogodin/react-native-fs';
import {runInAction} from 'mobx';
import {loadLlamaModelInfo} from 'llama.rn';

import {basicModel} from '../../../jest/fixtures/models';
import {modelStore} from '..';
import {Model, ModelOrigin, ModelType} from '../../utils/types';
import {FixtureType, GGUFFixture} from '../../utils/__tests__/ggufFixture';

const DIR = '/documents/models/local';
const PROJ_NAME = 'mmproj-LFM3-Omni-2B-Q8_0.gguf';
const PROJ_PATH = `${DIR}/${PROJ_NAME}`;

const model = (overrides: Partial<Model>): Model => ({
  ...basicModel,
  isLocal: true,
  origin: ModelOrigin.LOCAL,
  isDownloaded: true,
  ...overrides,
});

const push = (entry: Model): Model => {
  runInAction(() => {
    modelStore.models.push(entry);
  });
  return modelStore.models.find(m => m.id === entry.id)!;
};

const serve = (fixture: GGUFFixture) => {
  const bytes = fixture.build();
  (RNFS.read as jest.Mock).mockImplementation(
    async (_path: string, length: number, position: number) =>
      Buffer.from(bytes.slice(position, position + length)).toString('base64'),
  );
};

const pushPair = () => {
  const projector = push(
    model({
      id: 'projector',
      filename: 'mmproj-LFM3-Omni-2B-Q8_0.gguf',
      fullPath: PROJ_PATH,
      modelType: ModelType.PROJECTION,
    }),
  );
  const llm = push(
    model({
      id: 'omni',
      filename: 'LFM3-Omni-2B-Q8_0.gguf',
      fullPath: `${DIR}/LFM3-Omni-2B-Q8_0.gguf`,
      supportsMultimodal: true,
      compatibleProjectionModels: [projector.id],
      defaultProjectionModel: projector.id,
      mediaSupport: undefined,
      unsupportedMediaArchitecture: undefined,
      mediaSupportError: undefined,
    }),
  );
  return {projector, llm};
};

describe('ModelStore projector media capabilities', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'log').mockImplementation();

    (RNFS as any).__setDocumentDirectoryPath('/documents');
    runInAction(() => {
      modelStore.models = [];
    });

    (RNFS.exists as jest.Mock).mockResolvedValue(true);
    (RNFS.read as jest.Mock).mockReset();
    (loadLlamaModelInfo as jest.Mock).mockReset();
    (loadLlamaModelInfo as jest.Mock).mockResolvedValue({});
  });

  it('persists an omni projector on both files of the pair', async () => {
    serve(
      new GGUFFixture()
        .kv('general.architecture', {
          type: FixtureType.STRING,
          value: 'clip',
        })
        .kv('clip.has_vision_encoder', {type: FixtureType.BOOL, value: true})
        .kv('clip.has_audio_encoder', {type: FixtureType.BOOL, value: true})
        .kv('clip.has_gen_audio_encoder', {
          type: FixtureType.BOOL,
          value: true,
        })
        .kv('clip.vision.projector_type', {
          type: FixtureType.STRING,
          value: 'lfm3vl',
        })
        .kv('clip.audio.projector_type', {
          type: FixtureType.STRING,
          value: 'lfm3a',
        })
        .kv('clip.gen.audio.projector_type', {
          type: FixtureType.STRING,
          value: 'lfm3a_gen',
        }),
    );
    const {projector, llm} = pushPair();

    await modelStore.fetchAndPersistGGUFMetadata(projector);

    expect(projector.mediaSupport).toEqual({
      vision: true,
      audioInput: true,
      audioOutput: true,
    });
    expect(projector.mediaProjectorTypes).toEqual({
      vision: 'lfm3vl',
      audio: 'lfm3a',
      genAudio: 'lfm3a_gen',
      single: undefined,
    });
    expect(llm.mediaSupport).toEqual({
      vision: true,
      audioInput: true,
      audioOutput: true,
    });
    expect(llm.supportsMultimodal).toBe(true);
    expect(llm.modelType).toBe(ModelType.VISION);
    expect(llm.capabilities).toContain('vision');
  });

  it('trusts the pair for speech before anything is attached', async () => {
    serve(
      new GGUFFixture()
        .kv('general.architecture', {
          type: FixtureType.STRING,
          value: 'clip',
        })
        .kv('clip.has_audio_encoder', {type: FixtureType.BOOL, value: true})
        .kv('clip.has_gen_audio_encoder', {
          type: FixtureType.BOOL,
          value: true,
        })
        .kv('clip.gen.audio.projector_type', {
          type: FixtureType.STRING,
          value: 'lfm3a_gen',
        }),
    );
    const {projector, llm} = pushPair();
    await modelStore.fetchAndPersistGGUFMetadata(projector);
    runInAction(() => {
      modelStore.activeModelId = llm.id;
      modelStore.isMultimodalActive = false;
    });

    // Voice mode starts before any media has been sent, so nothing is attached
    // yet — the decoder claim has to survive that.
    expect(modelStore.activeMediaSupport.audioOutput).toBe(false);
    expect(modelStore.activeModelCanSpeak).toBe(true);

    runInAction(() => {
      llm.mediaSupport = {vision: true, audioInput: true, audioOutput: false};
    });
    expect(modelStore.activeModelCanSpeak).toBe(false);
  });

  it('marks an lfm2a projector unsupported and does not advertise audio', async () => {
    serve(
      new GGUFFixture()
        .kv('general.architecture', {
          type: FixtureType.STRING,
          value: 'lfm2',
        })
        .kv('clip.has_audio_encoder', {type: FixtureType.BOOL, value: true})
        .kv('clip.projector_type', {
          type: FixtureType.STRING,
          value: 'lfm2a',
        }),
    );
    const {projector, llm} = pushPair();

    await modelStore.fetchAndPersistGGUFMetadata(projector);

    expect(projector.mediaSupport).toEqual({
      vision: false,
      audioInput: false,
      audioOutput: false,
    });
    expect(projector.unsupportedMediaArchitecture).toBe('lfm2a');
    expect(projector.mediaSupportError).toBeUndefined();
    expect(llm.mediaSupport).toEqual({
      vision: false,
      audioInput: false,
      audioOutput: false,
    });
    expect(llm.unsupportedMediaArchitecture).toBe('lfm2a');
  });

  it('records a header that cannot be read without inventing support', async () => {
    (RNFS.read as jest.Mock).mockRejectedValue(new Error('read failed'));
    const {projector} = pushPair();

    await modelStore.fetchAndPersistGGUFMetadata(projector);

    expect(projector.mediaSupport).toBeUndefined();
    expect(projector.unsupportedMediaArchitecture).toBeUndefined();
    expect(projector.mediaSupportError).toMatch(/read failed/);
  });

  it('hydrates a projector persisted before header capabilities were read', async () => {
    serve(
      new GGUFFixture()
        .kv('clip.has_vision_encoder', {type: FixtureType.BOOL, value: true})
        .kv('clip.has_audio_encoder', {type: FixtureType.BOOL, value: true})
        .kv('clip.vision.projector_type', {
          type: FixtureType.STRING,
          value: 'lfm3vl',
        }),
    );
    const {projector, llm} = pushPair();

    expect(projector.mediaSupport).toBeUndefined();
    await modelStore.hydrateMediaSupport();

    expect(projector.mediaSupport).toEqual({
      vision: true,
      audioInput: true,
      audioOutput: false,
    });
    expect(llm.mediaSupport).toEqual({
      vision: true,
      audioInput: true,
      audioOutput: false,
    });
  });

  it('repairs a missing default projector with the Q8_0 file', async () => {
    const projector = (id: string, filename: string) =>
      push(
        model({
          id,
          filename,
          fullPath: `${DIR}/${filename}`,
          modelType: ModelType.PROJECTION,
          mediaSupport: {vision: true, audioInput: false, audioOutput: false},
        }),
      );
    const q4 = projector('proj-q4_0', 'mmproj-model-q4_0.gguf');
    const f16 = projector('proj-f16', 'mmproj-model-f16.gguf');
    const q8 = projector('proj-q8_0', 'mmproj-model-q8_0.gguf');
    const llm = push(
      model({
        id: 'needs-default',
        filename: 'model.gguf',
        fullPath: `${DIR}/model.gguf`,
        supportsMultimodal: true,
        compatibleProjectionModels: [q4.id, f16.id, q8.id],
        defaultProjectionModel: undefined,
      }),
    );

    await modelStore.hydrateMediaSupport();

    expect(llm.defaultProjectionModel).toBe(q8.id);
  });

  // A document URI gives no path to read before the copy lands, so `exists`
  // only answers for the destination once the file is actually there.
  const stagePickedCopy = () => {
    let copied = false;
    (RNFS.copyFile as jest.Mock).mockImplementation(
      async (_from: string, _to: string) => {
        copied = true;
      },
    );
    (RNFS.exists as jest.Mock).mockImplementation(
      async (path: string) => copied || path !== PROJ_PATH,
    );
    (RNFS.stat as jest.Mock).mockResolvedValue({size: 300e6});
    return () => copied;
  };

  it('pairs a projector the user picked from the device', async () => {
    serve(
      new GGUFFixture()
        .kv('clip.has_vision_encoder', {type: FixtureType.BOOL, value: true})
        .kv('clip.has_audio_encoder', {type: FixtureType.BOOL, value: true})
        .kv('clip.has_gen_audio_encoder', {
          type: FixtureType.BOOL,
          value: true,
        })
        .kv('clip.vision.projector_type', {
          type: FixtureType.STRING,
          value: 'lfm3vl',
        })
        .kv('clip.audio.projector_type', {
          type: FixtureType.STRING,
          value: 'lfm3a',
        }),
    );
    stagePickedCopy();
    const llm = push(
      model({
        id: 'unpaired',
        filename: 'LFM3-Omni-2B-Q8_0.gguf',
        fullPath: `${DIR}/LFM3-Omni-2B-Q8_0.gguf`,
        supportsMultimodal: false,
      }),
    );

    const projector = await modelStore.addManualProjector(
      llm.id,
      `/storage/emulated/0/Download/${PROJ_NAME}`,
    );

    expect(RNFS.copyFile).toHaveBeenCalledWith(
      `/storage/emulated/0/Download/${PROJ_NAME}`,
      PROJ_PATH,
    );
    expect(projector?.modelType).toBe(ModelType.PROJECTION);
    expect(llm.mmprojPath).toBe(PROJ_PATH);
    expect(llm.defaultProjectionModel).toBe(projector?.id);
    expect(llm.mediaSupport).toEqual({
      vision: true,
      audioInput: true,
      audioOutput: true,
    });
  });

  it('drops a picked file whose header carries no encoder', async () => {
    serve(
      new GGUFFixture().kv('general.architecture', {
        type: FixtureType.STRING,
        value: 'lfm3',
      }),
    );
    stagePickedCopy();
    const llm = push(
      model({
        id: 'wrong-pick',
        filename: 'LFM3-Omni-2B-Q8_0.gguf',
        fullPath: `${DIR}/LFM3-Omni-2B-Q8_0.gguf`,
        supportsMultimodal: false,
      }),
    );

    await expect(
      modelStore.addManualProjector(llm.id, `/Download/${PROJ_NAME}`),
    ).resolves.toBeUndefined();

    expect(RNFS.unlink).toHaveBeenCalledWith(PROJ_PATH);
    expect(modelStore.models.some(m => m.fullPath === PROJ_PATH)).toBe(false);
    expect(llm.mmprojPath).toBeUndefined();
    expect(llm.defaultProjectionModel).toBeUndefined();
  });
});

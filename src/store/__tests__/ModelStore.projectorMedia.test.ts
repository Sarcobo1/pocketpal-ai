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
const PROJ_PATH = `${DIR}/mmproj-LFM3-Omni-2B-Q8_0.gguf`;

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
});

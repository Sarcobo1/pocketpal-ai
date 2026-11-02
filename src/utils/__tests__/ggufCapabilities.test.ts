import {
  EMPTY_MEDIA_SUPPORT,
  hasMedia,
  isMediaGGUFKey,
  mediaCapabilitiesFromGGUFValues,
  mediaSupportOf,
  mergeMediaSupport,
  projectorIsUsable,
} from '../ggufCapabilities';
import {localFileSource, scanGGUFHeader} from '../ggufHeader';
import {FixtureType, GGUFFixture} from './ggufFixture';

const readFixture = async (fixture: GGUFFixture) => {
  const bytes = fixture.build();
  const source = localFileSource(
    '/models/mmproj.gguf',
    async (_path, len, at) =>
      Buffer.from(bytes.slice(at, at + len)).toString('base64'),
  );
  const scan = await scanGGUFHeader(source, {keyFilter: isMediaGGUFKey});
  return mediaCapabilitiesFromGGUFValues(scan.values);
};

describe('GGUF media capabilities', () => {
  it('reads an LFM3-Omni projector as vision, audio input, and audio output', async () => {
    const fixture = new GGUFFixture()
      .kv('general.architecture', {type: FixtureType.STRING, value: 'clip'})
      .kv('clip.has_vision_encoder', {type: FixtureType.BOOL, value: true})
      .kv('clip.has_audio_encoder', {type: FixtureType.BOOL, value: true})
      .kv('clip.has_gen_audio_encoder', {type: FixtureType.BOOL, value: true})
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
      });

    await expect(readFixture(fixture)).resolves.toEqual({
      mediaSupport: {vision: true, audioInput: true, audioOutput: true},
      projectorTypes: {
        vision: 'lfm3vl',
        audio: 'lfm3a',
        genAudio: 'lfm3a_gen',
        single: undefined,
      },
    });
  });

  it('reports LFM2.5-Audio as unsupported instead of faking audio support', async () => {
    const fixture = new GGUFFixture()
      .kv('general.architecture', {type: FixtureType.STRING, value: 'lfm2'})
      .kv('clip.has_audio_encoder', {type: FixtureType.BOOL, value: true})
      .kv('clip.projector_type', {
        type: FixtureType.STRING,
        value: 'lfm2a',
      });

    await expect(readFixture(fixture)).resolves.toEqual({
      mediaSupport: EMPTY_MEDIA_SUPPORT,
      projectorTypes: {
        vision: undefined,
        audio: undefined,
        genAudio: undefined,
        single: 'lfm2a',
      },
      unsupportedArchitecture: 'lfm2a',
    });
  });

  it('keeps a vision-only projector vision-only', async () => {
    const fixture = new GGUFFixture()
      .kv('general.architecture', {type: FixtureType.STRING, value: 'clip'})
      .kv('clip.has_vision_encoder', {type: FixtureType.BOOL, value: true})
      .kv('clip.vision.projector_type', {
        type: FixtureType.STRING,
        value: 'gemma4',
      });

    const caps = await readFixture(fixture);
    expect(caps.mediaSupport).toEqual({
      vision: true,
      audioInput: false,
      audioOutput: false,
    });
    expect(caps.unsupportedArchitecture).toBeUndefined();
  });

  it('treats a text-only LLM header as no media support', async () => {
    const fixture = new GGUFFixture()
      .kv('general.architecture', {type: FixtureType.STRING, value: 'llama'})
      .kv('llama.block_count', {type: FixtureType.UINT32, value: 32});

    const caps = await readFixture(fixture);
    expect(caps.mediaSupport).toEqual(EMPTY_MEDIA_SUPPORT);
    expect(caps.unsupportedArchitecture).toBeUndefined();
  });

  it('requires both header flags and projector compatibility', () => {
    expect(
      mediaCapabilitiesFromGGUFValues({
        'clip.has_audio_encoder': true,
        'clip.projector_type': 'lfm2a',
      }).mediaSupport,
    ).toEqual(EMPTY_MEDIA_SUPPORT);
  });

  it('merges runtime capability without dropping a declared modality', () => {
    expect(
      mergeMediaSupport(
        {vision: true, audioInput: true, audioOutput: false},
        {vision: false, audioInput: true, audioOutput: true},
      ),
    ).toEqual({vision: true, audioInput: true, audioOutput: true});
    expect(hasMedia(EMPTY_MEDIA_SUPPORT)).toBe(false);
  });

  describe('legacy defaults', () => {
    it('reads a model persisted before mediaSupport as vision-only', () => {
      expect(
        mediaSupportOf({supportsMultimodal: true, mediaSupport: undefined}),
      ).toEqual({vision: true, audioInput: false, audioOutput: false});
      expect(mediaSupportOf({supportsMultimodal: false})).toEqual(
        EMPTY_MEDIA_SUPPORT,
      );
    });

    it('trusts a scanned value over the legacy vision flag', () => {
      expect(
        mediaSupportOf({
          supportsMultimodal: true,
          mediaSupport: {vision: false, audioInput: true, audioOutput: false},
        }),
      ).toEqual({vision: false, audioInput: true, audioOutput: false});
    });

    it('treats an unscanned projector as usable and a broken one as not', () => {
      expect(projectorIsUsable({})).toBe(true);
      expect(
        projectorIsUsable({
          mediaSupport: {vision: true, audioInput: false, audioOutput: false},
        }),
      ).toBe(true);
      expect(
        projectorIsUsable({
          mediaSupport: EMPTY_MEDIA_SUPPORT,
        }),
      ).toBe(false);
      expect(projectorIsUsable({unsupportedMediaArchitecture: 'lfm2a'})).toBe(
        false,
      );
      expect(projectorIsUsable({mediaSupportError: 'read failed'})).toBe(false);
    });
  });
});

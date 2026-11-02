import type {GGUFValue} from './ggufHeader';
import type {MediaSupport} from './types';

export const EMPTY_MEDIA_SUPPORT: MediaSupport = {
  vision: false,
  audioInput: false,
  audioOutput: false,
};

export interface ProjectorTypes {
  vision?: string;
  audio?: string;
  genAudio?: string;
  /** Legacy `clip.projector_type`, used by single-encoder projectors. */
  single?: string;
}

export interface GGUFMediaCapabilities {
  mediaSupport: MediaSupport;
  projectorTypes: ProjectorTypes;
  /**
   * Set when the header describes a projector this build cannot drive. It is
   * deliberately separate from `mediaSupport: false`: a broken/unknown file
   * and a known-incompatible architecture need different words in the UI.
   */
  unsupportedArchitecture?: string;
}

// LFM2.5-Audio ships an `lfm2a` projector; llama.cpp's mtmd support for it is
// not present in the runtime this app builds. Treat it as unsupported instead
// of advertising audio input that would fail at load time.
const UNSUPPORTED_PROJECTOR_TYPES = new Set(['lfm2a']);

const asBool = (value: GGUFValue | undefined): boolean =>
  value === true ||
  value === 1 ||
  (typeof value === 'string' && value.toLowerCase() === 'true');

const asString = (value: GGUFValue | undefined): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/**
 * Read the mmproj capability keys llama.cpp writes. Vision/audio input are
 * encoder flags; audio output is the separate generation encoder used by
 * omni models such as LFM3-Omni. A missing key means false, which is exactly
 * how llama.cpp itself treats these fields.
 */
export const mediaCapabilitiesFromGGUFValues = (
  values: Record<string, GGUFValue>,
): GGUFMediaCapabilities => {
  const projectorTypes: ProjectorTypes = {
    vision: asString(values['clip.vision.projector_type']),
    audio: asString(values['clip.audio.projector_type']),
    genAudio: asString(values['clip.gen.audio.projector_type']),
    single: asString(values['clip.projector_type']),
  };

  const allTypes = [
    projectorTypes.vision,
    projectorTypes.audio,
    projectorTypes.genAudio,
    projectorTypes.single,
  ].filter((type): type is string => !!type);
  const unsupported = allTypes.find(type =>
    UNSUPPORTED_PROJECTOR_TYPES.has(type.toLowerCase()),
  );

  if (unsupported) {
    return {
      mediaSupport: {...EMPTY_MEDIA_SUPPORT},
      projectorTypes,
      unsupportedArchitecture: unsupported,
    };
  }

  return {
    mediaSupport: {
      vision: asBool(values['clip.has_vision_encoder']),
      audioInput: asBool(values['clip.has_audio_encoder']),
      audioOutput: asBool(values['clip.has_gen_audio_encoder']),
    },
    projectorTypes,
  };
};

/** Keys the media scan needs. Keep this list narrow so the vocab is skipped. */
export const MEDIA_GGUF_KEYS = [
  'general.architecture',
  'clip.has_vision_encoder',
  'clip.has_audio_encoder',
  'clip.has_gen_audio_encoder',
  'clip.vision.projector_type',
  'clip.audio.projector_type',
  'clip.gen.audio.projector_type',
  'clip.projector_type',
] as const;

const MEDIA_KEY_SET = new Set<string>(MEDIA_GGUF_KEYS);

export const isMediaGGUFKey = (key: string): boolean => MEDIA_KEY_SET.has(key);

export const hasMedia = (support: MediaSupport | undefined): boolean =>
  !!support && (support.vision || support.audioInput || support.audioOutput);

export const mergeMediaSupport = (
  declared: MediaSupport | undefined,
  runtime: MediaSupport | undefined,
): MediaSupport => {
  if (!declared && !runtime) {
    return {...EMPTY_MEDIA_SUPPORT};
  }
  return {
    vision: !!runtime?.vision || !!declared?.vision,
    audioInput: !!runtime?.audioInput || !!declared?.audioInput,
    audioOutput: !!runtime?.audioOutput || !!declared?.audioOutput,
  };
};

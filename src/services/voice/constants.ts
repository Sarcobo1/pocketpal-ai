/**
 * A local model's voice reply holds its first speech chunk until the reply
 * settles or this long after the stream opens (ms). Synthesis next to a
 * decoding model roughly doubles time to first audio.
 */
export const VOICE_FIRST_CHUNK_HOLD_MS = 1500;

/** Silence after speech that ends an utterance (ms). */
export const VOICE_ENDPOINT_HANG_MS = 600;

/**
 * Wait after stopping the mic before starting it again (ms). The mic stays shut
 * for the whole turn — capture only restarts once the reply has finished
 * playing — so this is the tail of the half-duplex window: the model must not
 * hear the end of its own voice.
 */
export const VOICE_CAPTURE_SETTLE_MS = 400;

/**
 * Contiguous speech an utterance needs before it is sent. Shorter than this is
 * a cough, a key, or the tail of the model's own voice.
 */
export const VOICE_VAD_MIN_SPEECH_MS = 400;

/**
 * Speech has to stand this many times above the room tone to open an
 * utterance, and this many to hold one open. Two thresholds instead of one:
 * a single level makes a consonant at the end of a word look like the pause
 * that closes it.
 */
export const VOICE_VAD_ONSET_FACTOR = 3;
export const VOICE_VAD_HOLD_FACTOR = 1.8;

/**
 * Voice activity sensitivity: 1 is the tuned default, a higher number accepts
 * quieter speech by lowering both floors, a lower one demands louder.
 */
export const VOICE_VAD_SENSITIVITY = 1;

/** The quietest onset the floor will ever trust (~-36 dBFS). */
export const VOICE_VAD_FLOOR_MIN_RMS = 0.015;

/** ...the loudest (~-24 dBFS), so loud room tone cannot make the mic deaf. */
export const VOICE_VAD_FLOOR_MAX_RMS = 0.06;

/** Room tone below this is read as the digital floor, not as a quiet room. */
export const VOICE_VAD_TRACK_MIN_RMS = 0.002;

/** The room tone estimate falls this fast toward a quieter room (0..1). */
export const VOICE_VAD_NOISE_LEAK = 0.2;

/**
 * ...and rises this slow toward a louder one (0..1). Slow on purpose: speech
 * that briefly dips below the onset must not push the floor up under itself.
 */
export const VOICE_VAD_NOISE_RISE = 0.02;

/**
 * Audio at the start of every capture measures the room instead of the user:
 * the mic reopens for each turn, so the estimate is rebuilt from the quietest
 * chunk of this window (ms). It stays under `VOICE_VAD_MIN_SPEECH_MS` so a run
 * can never reach the length that opens an utterance before the room is known.
 */
export const VOICE_VAD_CALIBRATE_MS = 300;

/** Silence kept at the end of an utterance (ms); the rest is trimmed. */
export const VOICE_VAD_TAIL_MS = 120;

/**
 * A whole clip below this RMS (~-48 dBFS) is dead air, not a quiet voice, and
 * never costs a model turn. Deliberately far under the speech floors: the
 * endpointer owns the adaptive call, this one only refuses obvious nothing.
 */
export const VOICE_CLIP_MIN_RMS = 0.004;

/**
 * A started mic that delivers no audio within this long (ms) is restarted
 * once, then voice mode ends. iOS reports a failed recorder start only in
 * its log. Bringing up a Bluetooth headset's mic route takes 1–3 s.
 */
export const VOICE_MIC_WATCHDOG_MS = 3000;

/**
 * Loading Whisper and the voice longer than this (ms) ends the start with a
 * warning. A first load on a mid-range phone took about 21 s.
 */
export const VOICE_START_TIMEOUT_MS = 45_000;

/**
 * A spoken answer is listened to, not read, and every sentence past the second
 * costs the listener twice: the wait for the audio and then the words. Voice
 * turns only — a typed turn with the same model keeps the prompt it always had.
 */
export const VOICE_ANSWER_INSTRUCTION =
  'Answer in one or two short sentences. Your reply is read aloud, not shown as text.';

/**
 * What stands beside the clip in a spoken turn's user message.
 *
 * A spoken turn carries no words of its own, so a model that hears has nothing
 * to answer but the sound — and a model trained to be useful reads that as a
 * request to say the sound back. This is the turn asking for a reply instead.
 * It rides the user message and not the system prompt, because only here is the
 * input something the user spoke; a typed turn with the same model never sees
 * it. Text output needs no change: the `Respond with text.` guard is appended
 * to the system prompt separately, and both are in front of the model at once.
 */
export const VOICE_AUDIO_INSTRUCTION =
  'The user spoke the attached audio. Reply to what they said in 1-2 sentences. ' +
  'Do not repeat or transcribe it.';

/**
 * What a model-voice reply trades: how soon it starts against how smoothly it
 * goes. Three settings make the whole difference — whether the reply is heard
 * while it is still being decoded, how much audio is held back before the first
 * sound, and whether a reply falling behind hands itself to the device voice —
 * so they are grouped here instead of left as four switches to remember.
 *
 * The engine-side knobs (threads, batch, flash attention, projector device)
 * are deliberately absent: they belong to the model's own settings and only a
 * run on the device says what wins there. The Speech bench prints them.
 */
export type SpeechPresetId = 'fast' | 'balanced' | 'best';

export interface SpeechPreset {
  id: SpeechPresetId;
  /** Whether the reply is heard in pieces as it is decoded. */
  stream: boolean;
  /** The least audio held before the first sound, in seconds. */
  jitterSeconds: number;
  /** Whether a reply falling behind is finished by the device voice. */
  handoff: boolean;
}

export const SPEECH_PRESETS: Record<SpeechPresetId, SpeechPreset> = {
  fast: {id: 'fast', stream: true, jitterSeconds: 0.25, handoff: true},
  balanced: {id: 'balanced', stream: true, jitterSeconds: 0.4, handoff: true},
  best: {id: 'best', stream: false, jitterSeconds: 0.4, handoff: false},
};

export const DEFAULT_SPEECH_PRESET: SpeechPresetId = 'balanced';

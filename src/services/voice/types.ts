import type {AsrTier} from '../asr';

/** How one voice turn ended. Failures name the stage that failed. */
export type VoiceTurnOutcome =
  | 'empty'
  | 'answered'
  | 'interrupted'
  | 'transcribe_failed'
  | 'reply_failed'
  | 'speech_failed';

/**
 * One turn handed to the chat. A cascade turn carries `text`; an omni turn
 * carries the captured speech as a WAV path. `imageUris` is a camera frame
 * for the same turn.
 */
export interface VoiceTurnPayload {
  /** Empty for a turn the model hears instead of reads. */
  text: string;
  audioUri?: string;
  imageUris?: string[];
}

/** The chat the voice session talks to, backed by `useChatSession`. */
export interface VoiceTurnPort {
  /**
   * Sends `payload` as a spoken chat turn. `onTurnCreated` receives the
   * assistant turn's id once its row exists; the promise resolves when the
   * run settles.
   */
  send(
    payload: VoiceTurnPayload,
    onTurnCreated: (turnId: string) => void,
  ): Promise<void>;
  /** Stops the running reply, as the Stop button does. */
  stop(): void;
}

export interface VoiceTurnEvents {
  transcribed(text: string): void;
  speechStarted(): void;
}

export interface VoiceTurn {
  done: Promise<VoiceTurnOutcome>;
  /** Stops the speech and the run; the reply keeps what was generated. */
  interrupt(): Promise<void>;
}

/**
 * Turns one utterance into a reply. The cascade (whisper, chat model, TTS)
 * reads a transcript and speaks the answer; the omni engine hands the audio
 * itself to one multimodal model. Entry readiness and the memory check stay
 * in the session controller, which is also what picks the engine.
 */
export interface VoiceEngine {
  readonly id: 'cascade' | 'omni';
  /** Makes the speech models resident for the session; turns use `tier`. */
  prepare(tier: AsrTier): Promise<void>;
  /** Frees them; resolves once any in-flight decode has stopped. */
  release(): Promise<void>;
  runTurn(
    utterance: Uint8Array,
    port: VoiceTurnPort,
    on: VoiceTurnEvents,
  ): VoiceTurn;
}

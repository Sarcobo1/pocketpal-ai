import {energyVad, int16PcmToFloat32} from '../asr';
import {modelStore} from '../../store';
import {ModelOrigin} from '../../utils/types';
import {vtrace} from '../../utils/voiceTrace';

import {findTurn} from './chatTurns';
import {captureVoiceFrame} from './frameSource';
import {writeUtteranceWav} from './wav';
import type {
  VoiceEngine,
  VoiceTurn,
  VoiceTurnEvents,
  VoiceTurnOutcome,
  VoiceTurnPort,
} from './types';

/**
 * True when the loaded model is one projector away from hearing the mic:
 * an omni model reads the WAV itself, so Whisper and the TTS voice drop out
 * of the turn.
 */
export const isOmniVoiceModel = async (): Promise<boolean> => {
  if (
    !modelStore.isMultimodalActive ||
    modelStore.activeModel?.origin === ModelOrigin.REMOTE
  ) {
    return false;
  }
  const ctx = modelStore.context;
  if (!ctx) {
    return false;
  }
  try {
    return (await ctx.getMultimodalSupport()).audio === true;
  } catch (err) {
    console.warn('[voiceMode] audio support probe failed:', err);
    return false;
  }
};

/**
 * The active model answers the audio it is given: the utterance is written
 * as a WAV and sent as the turn, with no transcript in between. The chat
 * model is already the loaded one, so there is nothing to prepare.
 */
export class OmniVoiceEngine implements VoiceEngine {
  readonly id = 'omni';

  async prepare(): Promise<void> {}

  async release(): Promise<void> {}

  runTurn(
    utterance: Uint8Array,
    port: VoiceTurnPort,
    on: VoiceTurnEvents,
  ): VoiceTurn {
    let aborted = false;
    let turnId: string | null = null;
    let sending: Promise<void> | null = null;
    let interrupting: Promise<void> | null = null;
    let finished = false;

    const interrupt = (): Promise<void> => {
      if (finished) {
        return Promise.resolve();
      }
      interrupting ??= (async () => {
        aborted = true;
        vtrace('turn.interrupt', {sending: !!sending, turnId});
        if (!sending) {
          return;
        }
        port.stop();
        await sending.catch(() => {});
      })();
      return interrupting;
    };

    const run = async (): Promise<VoiceTurnOutcome> => {
      const vad = energyVad(int16PcmToFloat32(utterance));
      vtrace('vad', {
        passed: vad.passed,
        voicedMs: vad.voicedMs,
        ms: Math.round(vad.durationMs),
      });
      if (!vad.passed) {
        return 'empty';
      }
      let audioUri: string;
      try {
        audioUri = await writeUtteranceWav(utterance);
      } catch (err) {
        console.warn('[voiceMode] utterance write failed:', err);
        return 'reply_failed';
      }
      if (aborted) {
        return 'interrupted';
      }
      const imageUris = await captureVoiceFrame();
      if (aborted) {
        return 'interrupted';
      }
      vtrace('utt.wav', {
        bytes: utterance.length,
        audioUri,
        frames: imageUris.length,
      });
      on.transcribed('');
      sending = port.send(
        {
          text: '',
          audioUri,
          imageUris: imageUris.length ? imageUris : undefined,
        },
        id => {
          turnId = id;
        },
      );
      let sendFailed = false;
      try {
        await sending;
      } catch (err) {
        console.warn('[voiceMode] reply failed:', err);
        sendFailed = true;
      }
      vtrace('turn.sent', {turnId, failed: sendFailed});

      if (interrupting) {
        await interrupting;
        return 'interrupted';
      }
      const turn = turnId ? findTurn(turnId) : null;
      if (sendFailed || !turn || turn.message.metadata?.interrupted) {
        return 'reply_failed';
      }
      return 'answered';
    };
    const done = run().finally(() => {
      finished = true;
    });

    return {done, interrupt};
  }
}

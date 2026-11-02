import {when} from 'mobx';

import {energyVad, int16PcmToFloat32} from '../asr';
import {modelStore, ttsStore} from '../../store';
import {ModelOrigin} from '../../utils/types';
import {vtrace} from '../../utils/voiceTrace';

import {findTurn} from './chatTurns';
import {startPerf} from '../../utils/mediaPerf';
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
  if (modelStore.activeModel?.origin === ModelOrigin.REMOTE) {
    return false;
  }
  // The projector is what decides whether a model can hear, and llama.rn can
  // attach it to a context that is already running — so ask for it rather than
  // reading a flag a model loaded before its pairing never had.
  if (!(await modelStore.ensureMultimodalActive())) {
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
        const stopping = ttsStore.stop('interrupt').catch(() => {});
        port.stop();
        await sending.catch(() => {});
        await stopping;
      })();
      return interrupting;
    };

    const run = async (): Promise<VoiceTurnOutcome> => {
      const lap = startPerf();
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
      lap('utt.wav', {bytes: utterance.length});
      if (aborted) {
        return 'interrupted';
      }
      const imageUris = await captureVoiceFrame();
      lap('utt.frame', {frames: imageUris.length});
      if (aborted) {
        return 'interrupted';
      }
      vtrace('utt.wav', {
        bytes: utterance.length,
        audioUri,
        frames: imageUris.length,
      });
      on.transcribed('');
      // The reply is text until the model can voice itself, so the turn is not
      // over when the tokens stop: it is over when the voice stops with them.
      const stopWatching = when(
        () => {
          const startedId = ttsStore.voiceSpeechStarted;
          return startedId !== null && startedId === turnId;
        },
        () => on.speechStarted(),
      );
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
      lap('turn.reply', {turnId, failed: sendFailed});
      await when(() => ttsStore.playbackState.mode === 'idle');
      vtrace('turn.idle');
      stopWatching();
      vtrace('turn.sent', {turnId, failed: sendFailed});

      if (interrupting) {
        await interrupting;
        return 'interrupted';
      }
      const turn = turnId ? findTurn(turnId) : null;
      if (sendFailed || !turn || turn.message.metadata?.interrupted) {
        return 'reply_failed';
      }
      if (ttsStore.voiceStreamFailed === turnId) {
        return 'speech_failed';
      }
      return 'answered';
    };
    const done = run().finally(() => {
      finished = true;
    });

    return {done, interrupt};
  }
}

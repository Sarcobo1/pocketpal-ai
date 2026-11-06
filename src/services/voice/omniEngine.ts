import {when} from 'mobx';

import {modelStore, ttsStore} from '../../store';
import {ModelOrigin} from '../../utils/types';
import {vtrace} from '../../utils/voiceTrace';

import {findTurn} from './chatTurns';
import {addTurnInfo, logPerf, markTurn, startPerf} from '../../utils/mediaPerf';
import {VOICE_CLAIM_WAIT_MS} from './constants';
import {captureVoiceFrame} from './frameSource';
import {gateUtterance} from './speechLevel';
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
      const gate = gateUtterance(utterance);
      vtrace('utt.gate', {reason: gate.reason, speechMs: gate.speechMs});
      logPerf('utt.gate', {...gate});
      markTurn('gate');
      if (!gate.pass) {
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
      markTurn('wav');
      if (aborted) {
        return 'interrupted';
      }
      const imageUris = await captureVoiceFrame();
      lap('utt.frame', {frames: imageUris.length});
      markTurn('frame');
      // How long the clip the model has to listen to is: 16-bit mono at 16 kHz
      // is 32 bytes per millisecond.
      addTurnInfo({clipMs: Math.round(utterance.length / 32)});
      if (aborted) {
        return 'interrupted';
      }
      vtrace('utt.wav', {
        bytes: utterance.length,
        audioUri,
        frames: imageUris.length,
      });
      // The clip waits for the context's one claim before it is submitted.
      // The turn already waits for the reply to be *heard*; this is the other
      // half, that the answer before it has stopped being *made* — a clip put
      // in front of a decoding speech pass is a question that throws instead
      // of waiting, and the listener hears "Couldn't get an answer" for a turn
      // the model never saw. Bounded, and past the bound the utterance is cut
      // rather than waited out.
      const claim = await modelStore.yieldSpeechClaim(VOICE_CLAIM_WAIT_MS);
      if (claim !== 'no-speech') {
        addTurnInfo({claim});
      }
      if (aborted) {
        return 'interrupted';
      }
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
      // Everything between here and the first token is the model's, not the
      // app's: the template, the audio encode and the prefill it costs.
      markTurn('send');
      let sendFailed = false;
      try {
        await sending;
      } catch (err) {
        console.warn('[voiceMode] reply failed:', err);
        sendFailed = true;
      }
      lap('turn.reply', {turnId, failed: sendFailed});
      // The model hears its own reply through the microphone if the ear opens
      // while the loudspeaker is still going, so the turn waits for the whole
      // reply to have sounded — not for the last piece the player was handed.
      await ttsStore.waitReplyAudio();
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

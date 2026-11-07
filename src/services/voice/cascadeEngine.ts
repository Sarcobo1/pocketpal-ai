import {fromByteArray} from 'base64-js';
import {when} from 'mobx';

import {energyVad, int16PcmToFloat32, whisperAsrEngine} from '../asr';
import type {AsrTier, AsrTranscript} from '../asr';
import {getEngine, ttsRuntime} from '../tts';
import {asrStore, ttsStore} from '../../store';
import {measureEcho} from '../../utils/chat';
import {addTurnInfo, logPerf} from '../../utils/mediaPerf';
import {vtrace} from '../../utils/voiceTrace';

import {findTurn} from './chatTurns';
import {VOICE_ECHO_GUARD_MS} from './constants';
import {captureVoiceFrame} from './frameSource';
import {pcmLevel} from './speechLevel';
import type {
  VoiceEngine,
  VoiceTurn,
  VoiceTurnEvents,
  VoiceTurnOutcome,
  VoiceTurnPort,
} from './types';

/**
 * Whisper, then the chat model through the normal send path, then TTS.
 * The prepared Whisper tier and the voice's engine stay resident from
 * `prepare` to `release`.
 */
export class CascadeVoiceEngine implements VoiceEngine {
  readonly id = 'cascade';
  private tier: AsrTier | null = null;

  async prepare(tier: AsrTier): Promise<void> {
    this.tier = tier;
    const started = Date.now();
    await whisperAsrEngine.preload(tier);
    const whisperLoaded = Date.now();
    const voice = ttsStore.currentVoice;
    if (voice) {
      await ttsRuntime.acquire(getEngine(voice.engine), async () => {});
    }
    if (__DEV__) {
      console.log(
        `[voiceMode] prepare: whisper ${whisperLoaded - started} ms, voice ${
          Date.now() - whisperLoaded
        } ms`,
      );
    }
  }

  async release(): Promise<void> {
    this.tier = null;
    await whisperAsrEngine.release();
    if (!ttsStore.streamsReplies) {
      await ttsRuntime.release();
    }
  }

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
          await whisperAsrEngine.cancelTranscription().catch(err => {
            console.warn('[voiceMode] cancel transcription failed:', err);
          });
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
      const vad = energyVad(int16PcmToFloat32(utterance));
      vtrace('vad', {
        passed: vad.passed,
        voicedMs: vad.voicedMs,
        ms: Math.round(vad.durationMs),
      });
      // The clip's own numbers travel with the turn, exactly as they do on the
      // omni path, so a reply that came back wrong can be read against the sound
      // that produced it — on this path too, whether the turn is kept or dropped.
      const clipMs = Math.round(vad.durationMs);
      const clipRms = Number(pcmLevel(utterance).rms.toFixed(4));
      addTurnInfo({clipMs, clipRms, speechMs: vad.voicedMs});
      if (!vad.passed) {
        // The same refusal the omni path names, with the same numbers: too short
        // or too quiet to be a question, dropped before a model is asked
        // anything.
        logPerf('utt.drop', {
          reason: 'weak-clip',
          gate: 'vad',
          ms: clipMs,
          rms: clipRms,
          speechMs: vad.voicedMs,
        });
        return 'empty';
      }
      let transcript: AsrTranscript;
      try {
        if (!this.tier) {
          throw new Error('voice engine not prepared');
        }
        transcript = await whisperAsrEngine.transcribe(
          fromByteArray(utterance),
          {tier: this.tier, language: asrStore.spokenLanguage ?? undefined},
        );
      } catch (err) {
        if (aborted) {
          return 'interrupted';
        }
        console.warn('[voiceMode] transcribe failed:', err);
        return 'transcribe_failed';
      }
      if (aborted) {
        return 'interrupted';
      }
      const text = transcript.text.trim();
      vtrace('asr', {chars: text.length, rawChars: transcript.text.length});
      if (!text) {
        return 'empty';
      }
      // A clip recorded while the phone was still speaking is dropped before it
      // gets here, but the reply's words can also arrive just after it: the
      // microphone heard the loudspeaker. The shape of the words is the tell.
      const echo = measureEcho(text, ttsStore.lastSpokenText);
      const spokenAgo = Date.now() - ttsStore.lastSpokenAt;
      if (echo.echo && spokenAgo <= VOICE_ECHO_GUARD_MS) {
        logPerf('utt.drop', {
          reason: 'self-echo',
          chars: text.length,
          ratio: echo.ratio,
          shared: echo.shared,
          spokenAgo,
        });
        return 'empty';
      }
      const imageUris = await captureVoiceFrame();
      if (aborted) {
        return 'interrupted';
      }
      on.transcribed(text);
      const stopWatching = when(
        () => {
          const startedId = ttsStore.voiceSpeechStarted;
          return startedId !== null && startedId === turnId;
        },
        () => on.speechStarted(),
      );
      sending = port.send(
        {text, imageUris: imageUris.length ? imageUris : undefined},
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
      // A turn is not over when its tokens stop: it is over when the last piece
      // of its audio has been heard, hand-offs and gaps between pieces included.
      await ttsStore.waitReplyAudio();
      vtrace('turn.idle');
      stopWatching();

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

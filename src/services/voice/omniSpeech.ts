import {neuralAudioPlayer} from '@pocketpalai/react-native-speech/engine-sdk';

import {modelStore, ttsStore} from '../../store';
import {ModelOrigin} from '../../utils/types';
import {logPerf} from '../../utils/mediaPerf';
import {vtrace} from '../../utils/voiceTrace';

/**
 * LFM3-Omni carries its speech decoder in the same projector file it already
 * loads to hear the microphone, so a reply does not have to go through a TTS
 * engine at all. Whether the running context can voice a reply is a property
 * of the model, not of the user's voice choice, so this is the one place that
 * asks for it — and the one place that then asks the model to speak.
 */

let probe: {contextId: number; audioGen: boolean} | null = null;

/**
 * True when the active model can voice its own reply.
 *
 * Two files answer that question, and they do not always agree: the projector's
 * GGUF header says what the download carries, the live context says what
 * llama.rn actually loaded into memory. Either is enough to *ask* — a context
 * that cannot answer says so with `stopReason:'unsupported'` and the reply goes
 * to the TTS voice — so the gate takes the union and the log says which one
 * spoke, because "the model has no voice" and "this build cannot hear the model
 * that has one" need different fixes.
 */
export const modelCanVoiceReplies = async (): Promise<boolean> => {
  const declared = modelStore.activeModelCanSpeak === true;
  const refuse = (reason: string, runtime?: boolean) => {
    logPerf('speech.gate', {reason, declared, runtime});
    return false;
  };
  if (ttsStore.forceTTSFallback) {
    return refuse('forced-fallback');
  }
  if (modelStore.activeModel?.origin === ModelOrigin.REMOTE) {
    return refuse('remote');
  }
  const ctx = modelStore.context;
  if (!ctx) {
    return refuse('no-context');
  }
  if (probe?.contextId === ctx.id && probe.audioGen) {
    return true;
  }
  let runtime = false;
  try {
    runtime = (await ctx.getMultimodalSupport()).audioGen === true;
  } catch (err) {
    console.warn('[voice] speech support probe failed:', err);
  }
  probe = {contextId: ctx.id, audioGen: runtime};
  if (runtime || declared) {
    logPerf('speech.gate', {
      reason: runtime ? 'runtime' : 'header',
      declared,
      runtime,
    });
    return true;
  }
  return refuse('none');
};

/** A reply longer than this is not one sentence anyone wants to hear spoken. */
const MAX_UTTERANCE_SECONDS = 30;

/**
 * Generating takes this long relative to the audio it makes and the wait is
 * the point of the exercise. Past it the TTS voice answers sooner in a voice
 * the user chose, so the model's own voice stops being the better offer.
 */
const MAX_REALTIME_FACTOR = 4;

/**
 * Reasons the pipeline itself declined. They will not change with the next
 * reply, so the session stops asking.
 */
const DEAD_ENDS = new Set(['no-tts-template', 'unsupported', 'failed']);

/**
 * Reasons the utterance decoded over the conversation's own positions. A
 * refusal before the first batch touched the context is not one of them.
 */
const TOUCHED_CACHE = new Set(['eos', 'max', 'aborted']);

export interface ModelSpeechReport {
  /** The audio reached the player and played out. */
  spoken: boolean;
  /** False when this model should not be asked again this session. */
  keepModelVoice: boolean;
  stopReason: string;
  seconds: number;
  frames: number;
  msPerFrame: number;
  /** Synthesis ms per audio ms: above 1 is slower than real time. */
  rtf: number;
  language: string;
  voice: string;
}

const report = (
  part: Partial<ModelSpeechReport> & {stopReason: string},
): ModelSpeechReport => ({
  spoken: false,
  keepModelVoice: true,
  seconds: 0,
  frames: 0,
  msPerFrame: 0,
  rtf: 0,
  language: 'template',
  voice: 'template',
  ...part,
});

/**
 * Say `text` with the model's own voice and wait for the audio to finish.
 *
 * The utterance is generated in one piece, behind the same context claim a
 * completion takes, so the reply's text is complete before a sample exists.
 * What comes back is one buffer: it plays through the neural TTS player, which
 * is already what the device's audio focus and ducking are arranged around.
 */
export const speakWithModel = async (
  text: string,
  onPlaying?: () => void,
): Promise<ModelSpeechReport> => {
  const ctx = modelStore.context;
  const language = ttsStore.speechLanguage.trim();
  if (!ctx) {
    return report({stopReason: 'unsupported', keepModelVoice: false});
  }
  // The bridge is a build-time thing: a bundle without the patched llama.rn has
  // no method to call, and saying so is cheaper than a TypeError per reply.
  if (typeof ctx.generateSpeech !== 'function') {
    logPerf('speech.method', {present: false});
    return report({stopReason: 'unsupported', keepModelVoice: false});
  }
  const out = await ctx
    .generateSpeech({
      text,
      ...(language ? {language} : {}),
      maxSeconds: MAX_UTTERANCE_SECONDS,
    })
    .catch(err => {
      console.warn('[voice] speech generation failed:', err);
      return null;
    });
  if (!out) {
    return report({
      stopReason: 'failed',
      keepModelVoice: false,
      language: language || 'template',
    });
  }
  const audioMs = out.seconds * 1000;
  const rtf = audioMs > 0 ? out.genMs / audioMs : Infinity;
  const msPerFrame = out.frames > 0 ? out.genMs / out.frames : 0;
  logPerf('speech.reply', {
    stop: out.stopReason,
    chars: text.length,
    frames: out.frames,
    seconds: out.seconds.toFixed(2),
    msPerFrame: msPerFrame.toFixed(1),
    promptMs: out.promptMs,
    genMs: out.genMs,
    rtf: rtf.toFixed(2),
    lang: language || 'template',
    voice: 'template',
  });
  // The template decides its own defaults, so the only faithful record of the
  // language and voice a reply was spoken with is the prompt it rendered.
  vtrace('speech.prompt', {
    lang: language || 'template',
    chars: out.prompt.length,
    head: out.prompt.slice(0, 160),
  });

  // The frames decoded over the positions the conversation owns: whatever the
  // next turn reuses from the cache is now part of this utterance's state.
  if (TOUCHED_CACHE.has(out.stopReason)) {
    await ctx.clearCache(true).catch(err => {
      console.warn('[voice] cache clear after speech failed:', err);
    });
  }

  const deadEnd = DEAD_ENDS.has(out.stopReason);
  const interrupted = out.stopReason === 'aborted';
  // Past the real-time factor the wait costs more than the voice is worth, so
  // the buffer is dropped and the TTS voice says this reply instead.
  const keepModelVoice =
    !deadEnd && rtf <= MAX_REALTIME_FACTOR && out.pcm.length > 0;
  const done = {
    stopReason: out.stopReason,
    keepModelVoice,
    seconds: out.seconds,
    frames: out.frames,
    msPerFrame,
    rtf,
    language: language || 'template',
  };
  if (deadEnd || interrupted || !keepModelVoice) {
    return report(done);
  }

  onPlaying?.();
  const spoken = await neuralAudioPlayer
    .play(
      {
        samples: out.pcm,
        sampleRate: out.sampleRate,
        channels: 1,
        duration: out.seconds,
      },
      {ducking: true},
    )
    .then(() => true)
    .catch(err => {
      console.warn('[voice] speech playback failed:', err);
      return false;
    });
  return report({...done, spoken});
};

/**
 * Cut the utterance in flight short. Both halves are fire-and-forget: the
 * frame loop notices the flag between batches, and the player stops at once so
 * the microphone can open again.
 */
export const stopModelSpeech = (): void => {
  modelStore.context?.stopSpeech();
  neuralAudioPlayer.stop().catch(err => {
    console.warn('[voice] speech stop failed:', err);
  });
};

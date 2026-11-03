import {neuralAudioPlayer} from '@pocketpalai/react-native-speech/engine-sdk';

import {modelStore, ttsStore} from '../../store';
import {ModelOrigin} from '../../utils/types';
import {logPerf} from '../../utils/mediaPerf';
import {vtrace} from '../../utils/voiceTrace';
import {openSpeechFeed, type SpeechFeed} from './speechStream';

/**
 * LFM3-Omni carries its speech decoder in the same projector file it already
 * loads to hear the microphone, so a reply does not have to go through a TTS
 * engine at all. Whether the running context can voice a reply is a property
 * of the model, not of the user's voice choice, so this is the one place that
 * asks for it — and the one place that then asks the model to speak.
 */

let probe: {contextId: number; audioGen: boolean} | null = null;

/**
 * The feed of the reply being spoken, if any. A barge-in arrives through
 * `stopModelSpeech`, which is not given the reply it is interrupting, so the
 * one in flight is kept here — dropping its queue is the difference between a
 * reply that stops and one that keeps playing under the next question.
 */
let activeFeed: SpeechFeed | null = null;

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

/**
 * The language codes the model's own `tts` template resolves to a name. A value
 * outside this list is not rejected — the template writes it as it stands, so
 * `Russian` works and `ru` becomes `Perform TTS in ru`, which is a phrase the
 * model was never given a meaning for. That is why an unknown code is only
 * logged, and why the settings copy has to say what it actually does.
 */
const TTS_TEMPLATE_LANGUAGES = new Set([
  'ar',
  'da',
  'de',
  'el',
  'en',
  'en-us',
  'en-gb',
  'fi',
  'fr',
  'he',
  'it',
  'ja',
  'ko',
  'nl',
  'pl',
  'pt',
  'es',
  'sv',
  'tr',
  'zh',
]);

/**
 * Values that mean "no preference". The template reads an absent language as
 * English rather than deciding for itself, so this is only about not writing a
 * word the template cannot resolve.
 */
const UNSPECIFIED_LANGUAGES = new Set(['', 'auto', 'default', 'und']);

/**
 * What to hand the `tts` template for the configured speech language: the
 * lowercased code, or nothing at all when the setting is empty.
 *
 * The template's own default is American English, not "whatever the speaker
 * used" — so the log records the value that was left out as well, because the
 * two look the same in the prompt that finally renders.
 */
export const resolveSpeechLanguage = (
  configured: string,
): {language: string; known: boolean} => {
  const code = configured.trim().toLowerCase();
  if (UNSPECIFIED_LANGUAGES.has(code)) {
    return {language: '', known: true};
  }
  return {language: code, known: TTS_TEMPLATE_LANGUAGES.has(code)};
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
  /**
   * The part of the reply the model's voice gave up on, so the TTS voice can
   * finish the sentence rather than restart it or leave it hanging. Empty for
   * every reply that was not handed over.
   */
  resumeText: string;
  /** Which step of the native pipeline answered; empty once audio was said. */
  stage: string;
  /** What the engine itself blamed, when it said anything. */
  error: string;
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
  resumeText: '',
  seconds: 0,
  frames: 0,
  msPerFrame: 0,
  rtf: 0,
  language: 'template',
  voice: 'template',
  stage: '',
  error: '',
  ...part,
});

/**
 * Say `text` with the model's own voice and wait for the audio to finish.
 *
 * What comes back is one buffer: it plays through the neural TTS player, which
 * is already what the device's audio focus and ducking are arranged around.
 * With `streamSpeech` on, that buffer never exists — the player is fed piece by
 * piece while the engine is still decoding, and this resolves once the last
 * piece has played. Both cases take the same context claim a completion takes,
 * so the reply's text is complete before a sample is asked for.
 */
export const speakWithModel = async (
  text: string,
  onPlaying?: () => void,
): Promise<ModelSpeechReport> => {
  const ctx = modelStore.context;
  const {language, known} = resolveSpeechLanguage(ttsStore.speechLanguage);
  if (!known) {
    // Not a refusal: the words still go into the prompt as written, but this is
    // the line that explains a reply in a language nobody picked.
    logPerf('speech.lang', {code: language, resolved: false});
  }
  if (!ctx) {
    return report({
      stopReason: 'unsupported',
      stage: 'no-context',
      keepModelVoice: false,
    });
  }
  // The bridge is a build-time thing: a bundle without the patched llama.rn has
  // no method to call, and saying so is cheaper than a TypeError per reply.
  if (typeof ctx.generateSpeech !== 'function') {
    logPerf('speech.method', {present: false});
    return report({
      stopReason: 'unsupported',
      stage: 'no-method',
      keepModelVoice: false,
    });
  }
  let thrown = '';
  // One feed per reply. It owns the piece boundary and the pace of the output,
  // so the engine has only to hand samples over — and when the setting is off
  // no feed exists, which is the whole difference from the old behavior.
  // The reply's words go in as well: a cut is placed where the text says a
  // pause belongs, which is the only map from audio to sentence the engine gives.
  const handoff = ttsStore.slowSpeech === 'system';
  const feed = ttsStore.streamSpeech
    ? openSpeechFeed({text, allowHandoff: handoff})
    : null;
  activeFeed = feed;
  let announced = false;
  /** The words the model's voice gave up on, once it handed the reply over. */
  let resumeText = '';
  const out = await ctx
    .generateSpeech(
      {
        text,
        ...(language ? {language} : {}),
        maxSeconds: MAX_UTTERANCE_SECONDS,
        ...(feed ? {stream: true} : {}),
      },
      feed
        ? (samples, sampleRate) => {
            // The first sample on its way, not the first played: a long
            // synthesis must not look like a session with nothing to say, and
            // the jitter buffer is the feed's business, not the caller's.
            if (!announced) {
              announced = true;
              onPlaying?.();
            }
            feed.push(samples, sampleRate);
            // The feed has decided this reply cannot be made smooth. Stop the
            // engine rather than finish audio nobody will hear in time; the
            // samples already made still play out, and the TTS voice takes the
            // rest of the sentence where the ear was left.
            if (handoff && feed.handoffOffered()) {
              resumeText = feed.remainingText().trim();
              logPerf('speech.handoff', {
                said: text.length - resumeText.length,
                left: resumeText.length,
              });
              ctx.stopSpeech();
            }
          }
        : undefined,
    )
    .catch(err => {
      thrown = err instanceof Error ? err.message : String(err);
      console.warn('[voice] speech generation failed:', err);
      return null;
    });
  if (!out) {
    feed?.abort('js-bridge');
    activeFeed = null;
    // A throw is the bridge itself failing, so it never named a stage.
    logPerf('speech.reply', {
      stop: 'failed',
      stage: 'js-bridge',
      err: thrown.slice(0, 200),
      chars: text.length,
      frames: 0,
      seconds: '0.00',
      rtf: '-',
      lang: language || 'template',
      voice: 'template',
    });
    return report({
      stopReason: 'failed',
      stage: 'js-bridge',
      error: thrown,
      keepModelVoice: false,
      language: language || 'template',
    });
  }
  const audioMs = out.seconds * 1000;
  const rtf = audioMs > 0 ? out.genMs / audioMs : Infinity;
  const msPerFrame = out.frames > 0 ? out.genMs / out.frames : 0;
  logPerf('speech.reply', {
    stop: out.stopReason,
    stage: out.stage,
    err: out.error.slice(0, 200),
    chars: text.length,
    frames: out.frames,
    seconds: out.seconds.toFixed(2),
    msPerFrame: msPerFrame.toFixed(1),
    promptMs: out.promptMs,
    genMs: out.genMs,
    rtf: rtf.toFixed(2),
    lang: language || 'template',
    voice: 'template',
    // The two numbers streaming is judged on: what the engine took to make the
    // first sample, and how many pieces it had to make it in.
    stream: feed ? 'on' : 'off',
    chunks: out.chunks,
    firstAudioMs: out.firstAudioMs,
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
    const t0 = Date.now();
    await ctx.clearCache(true).catch(err => {
      console.warn('[voice] cache clear after speech failed:', err);
    });
    // The next turn pays for this in full prefill, so its TTFT is read
    // against this number rather than against the model.
    logPerf('speech.cache', {
      cleared: true,
      ms: Date.now() - t0,
      stop: out.stopReason,
    });
  }

  const deadEnd = DEAD_ENDS.has(out.stopReason);
  const interrupted = out.stopReason === 'aborted';
  // A streamed reply carries no buffer on the result — the samples went
  // somewhere else — so the pieces it made are what say there was audio.
  const hasAudio = feed ? out.chunks > 0 : out.pcm.length > 0;
  // Past the real-time factor the wait costs more than the voice is worth, so
  // the buffer is dropped and the TTS voice says this reply instead.
  const keepModelVoice = !deadEnd && rtf <= MAX_REALTIME_FACTOR && hasAudio;
  const done = {
    stopReason: out.stopReason,
    stage: out.stage,
    error: out.error,
    keepModelVoice,
    /** Empty unless this reply was handed over partway through saying itself. */
    resumeText,
    seconds: out.seconds,
    frames: out.frames,
    msPerFrame,
    rtf,
    language: language || 'template',
  };

  let spoken = false;
  let playError = '';
  if (feed) {
    // Every piece this reply made is already on its way to the ear; closing is
    // the wait for the last one to play out, which is what the sink asks for.
    const stats = await feed.close();
    spoken = stats.played;
    playError = stats.playError;
    activeFeed = null;
  }
  if (deadEnd || interrupted || !keepModelVoice) {
    // A whole-clip reply stops here, before a sample is heard. A streamed one
    // may already have been heard, and `spoken` says so: the fallback voice
    // stays behind it rather than talking over it.
    return report(spoken ? {...done, spoken} : done);
  }

  if (!feed) {
    onPlaying?.();
    spoken = await neuralAudioPlayer
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
        playError = err instanceof Error ? err.message : String(err);
        console.warn('[voice] speech playback failed:', err);
        return false;
      });
    logPerf('speech.playback', {
      ok: spoken,
      err: playError.slice(0, 200),
      samples: out.pcm.length,
      sampleRate: out.sampleRate,
      channels: 1,
      seconds: out.seconds.toFixed(2),
    });
  }
  // Audio the player refused is still the model's own voice working, so only
  // the stage moves: the next reply should keep asking the model.
  return report(
    spoken
      ? {...done, spoken}
      : {...done, spoken, stage: 'playback', error: playError},
  );
};

/**
 * Cut the utterance in flight short. All three halves are fire-and-forget: the
 * frame loop notices the flag between batches, the feed drops what it had not
 * played yet, and the player stops at once so the microphone can open again.
 */
export const stopModelSpeech = (): void => {
  const feed = activeFeed;
  activeFeed = null;
  modelStore.context?.stopSpeech();
  feed?.abort('barge-in');
  neuralAudioPlayer.stop().catch(err => {
    console.warn('[voice] speech stop failed:', err);
  });
};

import {neuralAudioPlayer} from '@pocketpalai/react-native-speech/engine-sdk';

import {modelStore, ttsStore} from '../../store';
import {ModelOrigin} from '../../utils/types';
import {
  addTurnInfo,
  logPerf,
  markTurn,
  markTurnLast,
} from '../../utils/mediaPerf';
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
 * Whether the running context can be asked for a sequence of its own.
 *
 * `n_parallel` is how many slots llama.cpp built the context with, and a second
 * one is exactly what `isolateSeq` asks for. On a single-slot context — the app's
 * default, since it only uses blocking completion — the prefill answers
 * `init: invalid seq_id[0][0] = 1 >= 1`, no sample is ever made, and the refusal
 * is a dead end: the model loses its voice for every reply after the first. The
 * setting is a wish, the slot count is a fact, and the fact wins.
 */
export const canIsolateSpeechSeq = (nParallel: number | undefined): boolean =>
  (nParallel ?? 1) >= 2;

/** What this context's speech calls will ask for. */
const speechIsolation = (): boolean =>
  ttsStore.speechKeepCache &&
  canIsolateSpeechSeq(modelStore.contextInitParams.n_parallel);

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
      // What the speech calls of this session will ask for, and the slot count
      // that decided it — the line that separates "no voice" from "one slot".
      seq: speechIsolation() ? 'isolated' : 'shared',
      slots: modelStore.contextInitParams.n_parallel ?? 1,
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
export const MAX_UTTERANCE_SECONDS = 30;

/**
 * What one codec frame of this model's audio is worth out loud: `wav_frame_stack`
 * (6) STFT frames at a hop of 320 samples, at the 24 kHz the LFM3-Audio projector
 * is built for — 6 × 320 / 24000.
 *
 * The frame count and the seconds are both reported by the engine, so one divided
 * by the other against this says whether the clip was decoded at the geometry it
 * was shipped for. A reply whose seconds are not its frames times this is the
 * model's own audio running long, which no player setting can explain.
 */
export const SPEECH_CODEC_FRAME_SECONDS = 0.08;

/**
 * Generating takes this long relative to the audio it makes and the wait is
 * the point of the exercise. Past it the TTS voice answers sooner in a voice
 * the user chose, so the model's own voice stops being the better offer.
 */
export const MAX_REALTIME_FACTOR = 4;

/**
 * Reasons the pipeline itself declined. They will not change with the next
 * reply, so the session stops asking.
 */
const DEAD_ENDS = new Set(['no-tts-template', 'unsupported', 'failed']);

/**
 * Reasons the utterance decoded over the conversation's own positions. A
 * refusal before the first batch touched the context is not one of them.
 * Exported because the speech bench has to repeat this decision to measure what
 * keeping the cache is worth — a probe that skipped it would not be measuring
 * the path the app takes.
 */
export const TOUCHED_CACHE = new Set(['eos', 'max', 'aborted']);

/**
 * Why the model's own voice was not kept for this reply, in the one word the
 * log and the bench both read. The two safety limits the reply is judged
 * against are invisible in the engine's own result — it says `eos` either way —
 * so the answer has to be derived from the numbers rather than guessed at.
 */
export const speechDropReason = ({
  rtf,
  seconds,
  stopReason,
  stage,
  hasAudio,
}: {
  rtf: number;
  seconds: number;
  stopReason: string;
  stage: string;
  hasAudio: boolean;
}): 'none' | 'rtf' | 'time' | 'no-audio' | 'aborted' | 'stop' => {
  if (stopReason === 'aborted') {
    return 'aborted';
  }
  if (DEAD_ENDS.has(stopReason)) {
    return 'stop';
  }
  // First, and before any rate: a reply that made no samples has no rate at all.
  // `rtf` is Infinity there only because nothing was spoken to divide by, and
  // calling that a speed problem blames the wrong thing.
  if (!hasAudio) {
    return 'no-audio';
  }
  if (rtf > MAX_REALTIME_FACTOR) {
    return 'rtf';
  }
  if (stage === 'max-seconds' || seconds >= MAX_UTTERANCE_SECONDS) {
    return 'time';
  }
  return 'none';
};

export interface ModelSpeechReport {
  /** The audio reached the player and played out. */
  spoken: boolean;
  /** False when this model should not be asked again this session. */
  keepModelVoice: boolean;
  stopReason: string;
  /** The safety limit that gave up on this reply, or `none`. */
  drop: ReturnType<typeof speechDropReason>;
  /** Whether the conversation's own prefix survived this utterance. */
  cacheKept: boolean;
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
  drop: 'none',
  cacheKept: false,
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
    ? openSpeechFeed({
        text,
        jitterSeconds: ttsStore.speechJitterSeconds,
        allowHandoff: handoff,
        // The first piece out is the first sound, and it is the number the
        // listener's wait is measured by — not the engine's first sample.
        onFirstPiece: () => markTurn('firstSound'),
      })
    : null;
  activeFeed = feed;
  let announced = false;
  /** The words the model's voice gave up on, once it handed the reply over. */
  let resumeText = '';
  // Where the speech pass begins. Its own prefill is the reason a voice turn
  // can pay for the conversation twice, and the timeline has to show that.
  markTurn('speech');
  const out = await ctx
    .generateSpeech(
      {
        text,
        ...(language ? {language} : {}),
        maxSeconds: MAX_UTTERANCE_SECONDS,
        // Ask the engine to decode the utterance on a sequence of its own and
        // drop that sequence again, so the conversation's prefix is left whole
        // and the next turn re-uses it instead of paying a full prefill. Only
        // when the context actually has a second slot to put it on.
        ...(speechIsolation() ? {isolateSeq: true} : {}),
        ...(feed ? {stream: true} : {}),
      },
      feed
        ? (samples, sampleRate) => {
            // The first sample on its way, not the first played: a long
            // synthesis must not look like a session with nothing to say, and
            // the jitter buffer is the feed's business, not the caller's.
            if (!announced) {
              announced = true;
              // The engine's first sample, which is ahead of the first sound:
              // the difference is the jitter buffer the feed holds.
              markTurn('audioOut');
              onPlaying?.();
            }
            // Every piece overwrites this one, so it ends up being the moment
            // the engine stopped handing samples over — the other half of a
            // stutter, which is the span between the first and the last.
            markTurnLast('audioLast');
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
      drop: 'stop',
      lang: language || 'template',
      voice: 'template',
    });
    return report({
      stopReason: 'failed',
      stage: 'js-bridge',
      error: thrown,
      keepModelVoice: false,
      drop: 'stop',
      language: language || 'template',
    });
  }
  const audioMs = out.seconds * 1000;
  const rtf = audioMs > 0 ? out.genMs / audioMs : Infinity;
  const msPerFrame = out.frames > 0 ? out.genMs / out.frames : 0;
  // How the audio reached this call, which is not the same as whether it was
  // asked to. A build that takes the flag hands back no buffer at all; one that
  // ignores it hands back the whole clip and calls no chunk, and that is the
  // delivery failing rather than the reply — so it is said out loud and the
  // buffer is played instead of thrown away.
  const fellBack = feed !== null && out.chunks === 0 && out.pcm.length > 0;
  const nativeStream = !feed
    ? 'off'
    : fellBack
      ? 'fell-back'
      : out.chunks > 1
        ? 'used'
        : out.chunks === 1
          ? 'single'
          : 'silent';
  // A streamed reply carries no buffer on the result — the samples went
  // somewhere else — so the pieces it made are what say there was audio.
  const hasAudio = out.chunks > 0 || out.pcm.length > 0;
  // The engine calls both a finished reply and a reply that outran a safety
  // limit the same stop reason, so the reason the voice was given up on is
  // derived from the numbers and written down while they are still on the page.
  const drop = speechDropReason({
    rtf,
    seconds: out.seconds,
    stopReason: out.stopReason,
    stage: out.stage,
    hasAudio,
  });
  // Asking for a sequence of its own is one thing; a build whose engine has no
  // such option answers without the flag, and then the cache was touched.
  const cacheKept = out.seqIsolated === true;
  // The length the frame count says this clip is, against the seconds the engine
  // says it lasts: 1.0 is a decode at the geometry the codec was shipped for, and
  // anything else is the model's own audio running long before a player sees it.
  const codecSeconds = out.frames * SPEECH_CODEC_FRAME_SECONDS;
  const stretch = codecSeconds > 0 ? out.seconds / codecSeconds : 0;
  // The spoken length of the reply per character, read against the ~15 chars/s the
  // feed plans segments with. A clip of the right length that still sounds slow is
  // the difference between stretched audio and a voice that speaks slowly.
  const secPerChar = out.seconds / Math.max(1, text.length);
  logPerf('speech.reply', {
    stop: out.stopReason,
    stage: out.stage,
    err: out.error.slice(0, 200),
    chars: text.length,
    frames: out.frames,
    seconds: out.seconds.toFixed(2),
    msPerFrame: msPerFrame.toFixed(1),
    codecSec: codecSeconds.toFixed(2),
    stretch: stretch.toFixed(2),
    secPerChar: secPerChar.toFixed(3),
    // The spread of the frame times, which is the difference between a slow
    // engine and one that stutters: the mean cannot tell those two apart.
    p50Frame: out.frameP50Ms,
    p95Frame: out.frameP95Ms,
    maxFrame: out.frameMaxMs,
    promptMs: Math.round(out.promptMs),
    genMs: Math.round(out.genMs),
    rtf: rtf.toFixed(2),
    lang: language || 'template',
    voice: 'template',
    // The two numbers streaming is judged on: what the engine took to make the
    // first sample, and how many pieces it had to make it in.
    stream: feed ? 'on' : 'off',
    native: nativeStream,
    chunks: out.chunks,
    firstAudioMs: Math.round(out.firstAudioMs),
    drop,
    cache: cacheKept ? 'kept' : 'shared',
  });
  // The same numbers on the turn's own line, so one grep gives the whole wait.
  addTurnInfo({
    promptMs: Math.round(out.promptMs),
    genMs: Math.round(out.genMs),
    firstAudioMs: Math.round(out.firstAudioMs),
    rtf: Number(rtf.toFixed(2)),
    stretch: Number(stretch.toFixed(2)),
    secPerChar: Number(secPerChar.toFixed(3)),
    drop,
    chunks: out.chunks,
    stream: feed ? 'on' : 'off',
    native: nativeStream,
    cache: cacheKept ? 'kept' : 'shared',
  });
  // The template decides its own defaults, so the only faithful record of the
  // language and voice a reply was spoken with is the prompt it rendered.
  vtrace('speech.prompt', {
    lang: language || 'template',
    chars: out.prompt.length,
    head: out.prompt.slice(0, 160),
  });

  // The frames decoded over the positions the conversation owns: whatever the
  // next turn reuses from the cache is now part of this utterance's state —
  // unless the engine decoded them on a sequence of its own and took them back
  // off again, which is the whole reason to ask for one.
  if (!cacheKept && TOUCHED_CACHE.has(out.stopReason)) {
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
    addTurnInfo({cacheMs: Date.now() - t0});
  }

  const deadEnd = DEAD_ENDS.has(out.stopReason);
  const interrupted = out.stopReason === 'aborted';
  // Past the real-time factor the wait costs more than the voice is worth, so
  // the buffer is dropped and the TTS voice says this reply instead.
  const keepModelVoice = !deadEnd && rtf <= MAX_REALTIME_FACTOR && hasAudio;
  const done = {
    stopReason: out.stopReason,
    stage: out.stage,
    error: out.error,
    keepModelVoice,
    drop,
    cacheKept,
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
    if (fellBack) {
      // The stream was asked for and not given: hand the one buffer to the same
      // feed, so the reply is heard as the model's own voice either way.
      logPerf('speech.streamfall', {
        samples: out.pcm.length,
        seconds: out.seconds.toFixed(2),
      });
      feed.push(out.pcm, out.sampleRate);
    }
    // Every piece this reply made is already on its way to the ear; closing is
    // the wait for the last one to play out, which is what the sink asks for.
    const stats = await feed.close();
    spoken = stats.played;
    playError = stats.playError;
    activeFeed = null;
    addTurnInfo({
      playRatio: Number(stats.playRatio.toFixed(2)),
      playRate: stats.playRate,
      mismatch: stats.rateMismatch,
    });
  }
  if (deadEnd || interrupted || !keepModelVoice) {
    // A whole-clip reply stops here, before a sample is heard. A streamed one
    // may already have been heard, and `spoken` says so: the fallback voice
    // stays behind it rather than talking over it.
    return report(spoken ? {...done, spoken} : done);
  }

  if (!feed) {
    onPlaying?.();
    // A whole clip reaches the player in one call, so the sample and the sound
    // land on the same moment; the streamed reply marks it from its first piece.
    markTurn('firstSound');
    // The length told to the player is the length of the audio it is handed.
    // The engine's own `seconds` can disagree with its samples — a codec that
    // rounds to a frame, a buffer cut at a limit — and a player told the longer
    // of the two plays the same samples slow.
    const clipSeconds = Math.max(
      0.001,
      out.pcm.length / Math.max(1, out.sampleRate),
    );
    const playT0 = Date.now();
    spoken = await neuralAudioPlayer
      .play(
        {
          samples: out.pcm,
          sampleRate: out.sampleRate,
          channels: 1,
          duration: clipSeconds,
        },
        {ducking: true},
      )
      .then(() => true)
      .catch(err => {
        playError = err instanceof Error ? err.message : String(err);
        console.warn('[voice] speech playback failed:', err);
        return false;
      });
    // The call resolves when the clip has been heard, so its wall time against
    // the seconds the samples carry is the playback ratio of the whole reply:
    // ~1.0 says the player opened at the rate it was given and lost nothing.
    const playMs = Date.now() - playT0;
    const playRatio = playMs / 1000 / clipSeconds;
    logPerf('speech.playback', {
      ok: spoken,
      err: playError.slice(0, 200),
      samples: out.pcm.length,
      sampleRate: out.sampleRate,
      channels: 1,
      seconds: out.seconds.toFixed(2),
      clip: clipSeconds.toFixed(2),
      drift: out.seconds > 0 ? (clipSeconds / out.seconds).toFixed(2) : 'n/a',
      wall: Math.round(playMs),
      ratio: playRatio.toFixed(2),
    });
    addTurnInfo({playRatio: Number(playRatio.toFixed(2))});
  }
  // Audio the player refused is still the model's own voice working, so only
  // the stage moves: the next reply should keep asking the model.
  return report(
    spoken
      ? {...done, spoken}
      : {...done, spoken, stage: 'playback', error: playError},
  );
};

/** The context whose speech pipeline has already been paid for. */
let prewarmedContext: number | null = null;

/**
 * Voice one throwaway syllable while nobody is waiting for it.
 *
 * The first utterance a context voices is slower than every one after it: the
 * generator and its buffers are built before a sample exists. A voice session
 * opens with exactly that gap — the speaker has not finished their sentence —
 * and one syllable stopped as it lands spends the gap on the pipeline instead
 * of the answer. The reply it warms up for is the first one that is fast.
 */
export const prewarmSpeech = async (): Promise<void> => {
  const ctx = modelStore.context;
  if (!ctx || typeof ctx.generateSpeech !== 'function') {
    return;
  }
  if (prewarmedContext === ctx.id) {
    return;
  }
  if (!(await modelCanVoiceReplies())) {
    return;
  }
  prewarmedContext = ctx.id;
  const t0 = Date.now();
  const out = await ctx
    .generateSpeech(
      {
        text: 'Aa.',
        maxSeconds: 1,
        stream: true,
        ...(speechIsolation() ? {isolateSeq: true} : {}),
      },
      // One sample is the whole point: everything before it is the cost being
      // paid in advance, so the utterance stops the moment it lands.
      () => ctx.stopSpeech(),
    )
    .catch(err => {
      console.warn('[voice] speech prewarm failed:', err);
      return null;
    });
  if (!out) {
    // Nothing was learned, so the next session asks again.
    prewarmedContext = null;
    return;
  }
  if (out.seqIsolated !== true && TOUCHED_CACHE.has(out.stopReason)) {
    // The warm-up decoded over the conversation's own positions, so it owes the
    // next turn the same clear a spoken reply would.
    await ctx.clearCache(true).catch(() => undefined);
  }
  logPerf('speech.prewarm', {
    ms: Date.now() - t0,
    promptMs: Math.round(out.promptMs),
    firstAudioMs: Math.round(out.firstAudioMs),
    frames: out.frames,
    stop: out.stopReason,
    stage: out.stage,
    cache: out.seqIsolated === true ? 'kept' : 'shared',
  });
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

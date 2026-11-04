import {logPerf} from '../../utils/mediaPerf';
import {openVoiceSink, type SinkMode, type VoiceSink} from './streamSink';

/**
 * Hearing a reply while the model is still saying it.
 *
 * The speech decoder hands out audio frame by frame, and the reply is not known
 * until the last of them, so a spoken answer is either waited for or streamed.
 * Streaming needs somewhere to put the samples as they arrive, and that place is
 * the whole problem: start playing too early and the output outruns the engine,
 * which is heard as a voice that stutters; start too late and the answer is slow,
 * which is heard as a machine thinking.
 *
 * Three rules hold the two together.
 *
 * - Nothing plays before there is a buffer in hand, and how big that buffer is
 *   comes from the pace the engine is actually keeping, not from a constant. An
 *   engine faster than real time needs barely any; one at half speed needs the
 *   shortfall of the whole reply.
 * - The output is one stream for the whole reply, so where one chunk stops and
 *   the next begins is not a place silence can appear.
 * - When the output does run dry, the reply pauses at the next boundary between
 *   words and starts again on a bigger buffer. One deliberate pause reads as a
 *   breath; the same time spent inside a syllable reads as a bad connection.
 */

/** The smallest buffer ever held. Less than this and the first word is at risk. */
export const DEFAULT_JITTER_SECONDS = 0.4;

/** However slow the engine, no reply is made to wait longer than this. */
export const DEFAULT_MAX_JITTER_SECONDS = 3;

/** A piece shorter than this cuts words apart for nothing. */
export const DEFAULT_MIN_SEGMENT_SECONDS = 0.5;

/**
 * How long a piece may grow when no quiet point turns up. Past this the buffer
 * is worth the risk of a cut mid-word, because the alternative is holding a
 * whole sentence back and losing the point of streaming.
 */
export const DEFAULT_MAX_SEGMENT_SECONDS = 2.5;

/** About how fast this model speaks, used to size a reply before it exists. */
export const SPEECH_CHARS_PER_SECOND = 15;

/** A dry spell shorter than this is not heard as a hole in the voice. */
const AUDIBLE_STARVE_MS = 80;

/** How far from a boundary in the text a quiet point still counts as that pause. */
const BIAS_WINDOW_SECONDS = 0.45;

/** Silence this long, and the ear is already expecting a stop. */
const QUIET_RUN_FRAMES = 2;

/** The window the energy of the stream is measured over. */
const QUIET_FRAME_MS = 20;

/**
 * RMS below this is a pause. Speech sits well above it and the decoder's own
 * silence sits well below, so the exact value is not delicate; what matters is
 * that a cut lands where the waveform is flat rather than inside a vowel.
 */
const QUIET_RMS = 0.01;

/**
 * A reply this far behind real time will not be smoothed by any buffer: the
 * listener has heard a second of it and has another one and a half to wait per
 * second spoken, which is the point at which the device voice is simply the
 * better offer. Exported because the bench prints the number it judged by.
 */
export const SLOW_SPEECH_RTF = 1.5;

/** Judged only after this much of it has been heard, so one slow frame is not it. */
const SLOW_SPEECH_AFTER_MS = 1000;

/** How much bigger the buffer gets every time the output goes dry. */
const REBUFFER_GROWTH = 1.5;

export interface SpeechFeedStats {
  /** Chunks handed to the output. */
  segments: number;
  /** Seconds of audio the feed saw. */
  seconds: number;
  /** Times this feed ran dry while the engine was still working. */
  underruns: number;
  /** Cuts made at the length cap with no pause to cut at. */
  forced: number;
  /** Times the reply paused at a boundary to rebuild the buffer. */
  rebuffers: number;
  /** Call start to the first sample reaching the output. */
  firstPlayMs: number;
  /** Call start to the last sample having played. */
  totalMs: number;
  /** Seconds of audio in hand, in milliseconds, when the first one went out. */
  jitterMs: number;
  /** Milliseconds the output was dry because the engine had not made the audio. */
  starveMs: number;
  /** Milliseconds of holes the output path itself caused. */
  gapMs: number;
  /** The worst single hole the output path caused. */
  gapMaxMs: number;
  /** Milliseconds the output reported having nothing queued. */
  dryMs: number;
  /** The output's own count of dry spells, or -1 when it has none to give. */
  nativeUnderruns: number;
  /** Milliseconds spent crossing the bridge to the output. */
  bridgeMs: number;
  /** Whether the reply went out as one stream or piece by piece. */
  sinkMode: SinkMode;
  /** Synthesis time per second of audio, measured as it happened. */
  rtf: number;
  /** Too far behind real time for any buffer to make it sound smooth. */
  slow: boolean;
  /** The player's own refusal, when it said one. */
  playError: string;
  /** Whether the whole reply was heard. */
  played: boolean;
}

export interface SpeechFeed {
  /** One piece of decoded PCM, as the native callback handed it over. */
  push(samples: Float32Array, sampleRate: number): void;
  /** No more audio: play out what is in hand and report. */
  close(): Promise<SpeechFeedStats>;
  /** Stop at once — a barge-in does not wait for the tail of a reply. */
  abort(reason: string): void;
  /** True once, when this reply cannot be made smooth and the offer stands. */
  handoffOffered(): boolean;
  /** The words of this reply the ear has not had. */
  remainingText(): string;
}

export interface SpeechFeedOptions {
  /** The output to play into. Created when left out. */
  sink?: VoiceSink;
  /** The reply being spoken, which is what lets a cut fall between words. */
  text?: string;
  /** Least buffer held before anything plays, whatever the engine's pace. */
  jitterSeconds?: number;
  /** The most buffer a reply is ever asked to wait for. */
  maxJitterSeconds?: number;
  minSegmentSeconds?: number;
  maxSegmentSeconds?: number;
  /** Offer the rest of the reply to the device voice once it is hopeless. */
  allowHandoff?: boolean;
  /**
   * The first piece on its way to the output. The engine's own first sample is
   * earlier than this by the jitter buffer, and the listener waits for this one,
   * so the turn's timeline is marked here rather than at the first `push`.
   */
  onFirstPiece?: () => void;
}

const emptyStats = (): SpeechFeedStats => ({
  segments: 0,
  seconds: 0,
  underruns: 0,
  forced: 0,
  rebuffers: 0,
  firstPlayMs: 0,
  totalMs: 0,
  jitterMs: 0,
  starveMs: 0,
  gapMs: 0,
  gapMaxMs: 0,
  dryMs: 0,
  nativeUnderruns: -1,
  bridgeMs: 0,
  sinkMode: 'pieces',
  rtf: 0,
  slow: false,
  playError: '',
  played: false,
});

/**
 * Where a spoken reply may stop: a strong mark is where the speaker meant a
 * sentence to end, a weak one is only where they meant to breathe. The feed and
 * the fast start cut on the same set, which is why it is written once.
 */
const STRONG_BREAK = new Set(['.', '!', '?', ':', '\n']);
const WEAK_BREAK = new Set([',', ';']);

/**
 * Where in `text` a spoken reply may be paused without cutting a word, as
 * fractions of the whole.
 *
 * The engine aligns no sample with any character, so the only map from audio to
 * text is the text itself and how fast it is read. Marks closer together than the
 * shortest piece are dropped: a plan the feed cannot honour would make every cut
 * worse than no plan at all.
 */
export const planSpeechBoundaries = (
  text: string,
  minSegmentSeconds: number,
): Array<{at: number; strong: boolean}> => {
  const length = text.length;
  if (length === 0) {
    return [];
  }
  const minChars = Math.max(
    1,
    Math.round(minSegmentSeconds * SPEECH_CHARS_PER_SECOND),
  );
  const marks: Array<{at: number; strong: boolean}> = [];
  let previous = 0;
  for (let i = 0; i < length; i++) {
    const c = text[i]!;
    const next = text[i + 1];
    // A terminator only counts where the next character starts a word, so an
    // ellipsis is one boundary and "3.5" is none.
    if (
      !(STRONG_BREAK.has(c) || WEAK_BREAK.has(c)) ||
      (next !== undefined && next !== ' ')
    ) {
      continue;
    }
    const end = i + 1;
    if (end - previous < minChars || end / length > 0.97) {
      continue;
    }
    marks.push({at: end / length, strong: STRONG_BREAK.has(c)});
    previous = end;
  }
  return marks;
};

/**
 * The part of a still-arriving reply that may be said now: its first sentence,
 * once that sentence is closed.
 *
 * A reply is streamed one token at a time, so this is asked over text that is not
 * finished, and the answer has to be conservative twice over. Nothing is handed
 * over until a terminator says a sentence ended — speaking half a sentence and
 * then repeating it is worse than the wait — and a mark at the very end of what
 * has arrived so far only counts when it is not a decimal point, because "3." may
 * still be becoming "3.5".
 *
 * Past `maxSeconds` of it, a weak mark is taken rather than none: a reply long
 * enough to have no punctuation for that long is not one the listener should have
 * to wait out whole.
 */
export const firstSpokenSentence = (
  text: string,
  {
    minSeconds = 1.2,
    maxSeconds = 14,
  }: {minSeconds?: number; maxSeconds?: number} = {},
): string => {
  const minChars = Math.max(
    1,
    Math.round(minSeconds * SPEECH_CHARS_PER_SECOND),
  );
  const maxChars = Math.max(
    minChars,
    Math.round(maxSeconds * SPEECH_CHARS_PER_SECOND),
  );
  const length = text.length;
  if (length < minChars) {
    return '';
  }
  let weakEnd = -1;
  for (let i = minChars - 1; i < length; i++) {
    const c = text[i]!;
    if (!STRONG_BREAK.has(c) && !WEAK_BREAK.has(c)) {
      continue;
    }
    // A mark is only a stop where the next word can begin, or where the text has
    // stopped — and a digit before the mark means it may still be inside a number.
    const next = text[i + 1];
    if (next !== undefined && next !== ' ') {
      continue;
    }
    if (next === undefined && /\d/.test(text[i - 1] ?? '')) {
      continue;
    }
    if (STRONG_BREAK.has(c)) {
      return text.slice(0, i + 1);
    }
    if (weakEnd < 0) {
      weakEnd = i + 1;
    }
  }
  if (length < maxChars) {
    return '';
  }
  if (weakEnd > 0) {
    return text.slice(0, weakEnd);
  }
  // No mark at all, and too long to keep waiting: stop at a word boundary.
  const space = text.lastIndexOf(' ', maxChars);
  return text.slice(0, space > minChars ? space : maxChars);
};

/**
 * Where to cut `buf`, or null when nothing may be cut yet.
 *
 * A cut is the midpoint of a silence run, so the pause is split between the piece
 * that ends and the piece that follows. Where the text planned a boundary, the
 * quiet point nearest it is taken, which puts the pause where the speaker meant
 * one rather than wherever the waveform happened to dip. Only when the cap is
 * reached with no pause in sight is a piece cut somewhere the speaker did not
 * mean to stop.
 */
const findCut = (
  buf: Float32Array,
  len: number,
  sampleRate: number,
  options: {
    /** Nothing shorter than this is handed over. */
    minSamples: number;
    /** The most audio one piece may carry. */
    capSamples: number;
    /** Where the text says a pause belongs, measured into the buffer. */
    marks: number[];
  },
): {at: number; forced: boolean} | null => {
  const {minSamples, capSamples, marks} = options;
  if (len < minSamples) {
    return null;
  }
  const frame = Math.max(1, Math.round((sampleRate * QUIET_FRAME_MS) / 1000));
  // Only whole frames are measured: a partial one at the end of the buffer would
  // average in samples that are not there and read them as silence.
  const usable = len - (len % frame);
  const isQuiet = (start: number): boolean => {
    let sum = 0;
    for (let i = start; i < start + frame; i++) {
      const s = buf[i]!;
      sum += s * s;
    }
    return Math.sqrt(sum / frame) < QUIET_RMS;
  };
  /** The midpoint of the first silence run reaching into `[from, to]`, or -1. */
  const quietRun = (from: number, to: number): number => {
    let runStart = -1;
    let runFrames = 0;
    for (
      let start = Math.ceil(from / frame) * frame;
      start + frame <= to;
      start += frame
    ) {
      if (isQuiet(start)) {
        if (runFrames === 0) {
          runStart = start;
        }
        runFrames++;
        continue;
      }
      if (runFrames >= QUIET_RUN_FRAMES) {
        return runStart + Math.round((runFrames * frame) / 2);
      }
      runFrames = 0;
    }
    return runFrames >= QUIET_RUN_FRAMES ? to : -1;
  };

  const endsQuiet = usable >= frame && isQuiet(usable - frame);
  const window = Math.round(BIAS_WINDOW_SECONDS * sampleRate);

  for (const mark of marks) {
    if (mark < minSamples || mark > len) {
      continue;
    }
    const found = quietRun(
      Math.max(minSamples, mark - window),
      Math.min(len, mark + window),
    );
    if (found >= 0) {
      return {at: Math.min(found, len), forced: false};
    }
    // The boundary has slipped past with no pause in the audio to cut at. A run
    // of silence at the very end is one, whatever the text said about where.
    if (endsQuiet) {
      return {at: len, forced: false};
    }
  }
  if (endsQuiet) {
    return {at: len, forced: false};
  }
  const found = quietRun(minSamples, len);
  if (found >= 0) {
    return {at: Math.min(found, len), forced: false};
  }
  if (len >= capSamples) {
    return {at: Math.min(capSamples, len), forced: true};
  }
  return null;
};

/**
 * Start feeding one reply's audio to the output.
 *
 * The feed owns the buffer, the boundary and the pace; the caller owns the
 * engine. Chunks arrive from a native callback thread-hopping onto the JS
 * thread, so nothing here may block: every push appends, decides, and hands a
 * chunk over without waiting for the one before it to be heard.
 */
export const openSpeechFeed = (options?: SpeechFeedOptions): SpeechFeed => {
  const minJitter = options?.jitterSeconds ?? DEFAULT_JITTER_SECONDS;
  const maxJitter = options?.maxJitterSeconds ?? DEFAULT_MAX_JITTER_SECONDS;
  const minSeconds = options?.minSegmentSeconds ?? DEFAULT_MIN_SEGMENT_SECONDS;
  const maxSeconds = options?.maxSegmentSeconds ?? DEFAULT_MAX_SEGMENT_SECONDS;
  const text = options?.text ?? '';
  const allowHandoff = options?.allowHandoff ?? false;
  const onFirstPiece = options?.onFirstPiece;
  const sink = options?.sink ?? openVoiceSink();
  const t0 = Date.now();

  const marks = planSpeechBoundaries(text, minSeconds);
  /** What the text says the reply will be, before any of it has been said. */
  const plannedSeconds = text.length / SPEECH_CHARS_PER_SECOND;

  // One growable buffer holds the audio not yet handed over. Copies are
  // whole-buffer `copyWithin`, so a reply costs one allocation per doubling.
  let buf = new Float32Array(48000);
  let len = 0;
  let rate = 0;
  let handedOver = 0;
  let chunks = 0;

  let aborted = false; /** The buffer is full enough that the output may be given audio. */
  let armed = false;
  /** Audio is going out, and the device has had none for a heard-long time. */
  let hungry = false;
  /** Ready to pause at the next boundary and rebuild the buffer bigger. */
  let rebufferWanted = false;
  let rebuffering = false;
  /** Set by `abort`, so a reply cut short is not reported as heard. */
  let bargeIn = false;
  let growth = 1;
  let playStartMs = 0;
  let paceAtMs = t0;
  let handoff = false;

  const stats = emptyStats();

  /** The reply's length in audio, as well as it is known. */
  const expectedSeconds = (): number => Math.max(plannedSeconds, stats.seconds);

  /**
   * How much audio must be in hand before playing, at this engine's pace: the
   * shortfall of the reply against its own generation, capped at what a listener
   * will put up with before an answer starts at all.
   */
  const jitterTarget = (): number => {
    const needed =
      stats.rtf > 1 ? expectedSeconds() * (stats.rtf - 1) : minJitter;
    // A rebuffer is allowed to make the wait longer, never longer than the one
    // number the listener agreed to: the cap holds after the growth, not before.
    return Math.min(Math.max(minJitter, needed) * growth, maxJitter);
  };

  /** The boundaries of the text, measured into the buffer as it now stands. */
  const markPositions = (): number[] => {
    const total = expectedSeconds() * Math.max(1, rate);
    const positions: number[] = [];
    for (const mark of marks) {
      const at = Math.round(mark.at * total) - handedOver;
      if (at > 0) {
        positions.push(at);
      }
    }
    return positions;
  };

  const append = (samples: Float32Array) => {
    if (len + samples.length > buf.length) {
      let size = buf.length * 2;
      while (size < len + samples.length) {
        size *= 2;
      }
      const bigger = new Float32Array(size);
      bigger.set(buf.subarray(0, len));
      buf = bigger;
    }
    buf.set(samples, len);
    len += samples.length;
  };

  /** Hand `[0, at)` to the output and keep the rest. */
  const emit = (at: number, forced: boolean) => {
    if (at <= 0 || len === 0) {
      return;
    }
    const take = Math.min(at, len);
    const samples = buf.slice(0, take);
    buf.copyWithin(0, take, len);
    len -= take;
    handedOver += take;
    stats.forced += forced ? 1 : 0;
    stats.segments++;
    sink.write(samples, rate);
    // The ear's clock starts here, not when the buffer was filled: until this
    // line there is no audio for the device to be behind. What was in hand at
    // this moment is the buffer the reply actually started with, which a slow
    // engine makes far larger than the minimum it was asked to hold.
    if (playStartMs === 0) {
      playStartMs = Date.now();
      stats.firstPlayMs = playStartMs - t0;
      stats.jitterMs = Math.round(((handedOver + len) / rate) * 1000);
      onFirstPiece?.();
    }
  };

  /**
   * The wall time since the last chunk, and whether the output went dry in it.
   *
   * Dry is arithmetic, not a guess: a device consumes audio at one second per
   * second, so once more time has passed than the amount handed over, the
   * difference was spent in silence.
   */
  const watchPace = (): number => {
    const now = Date.now();
    const interval = now - paceAtMs;
    paceAtMs = now;
    if (playStartMs > 0) {
      const heard = (handedOver / Math.max(1, rate)) * 1000;
      if (now - playStartMs - heard > AUDIBLE_STARVE_MS) {
        stats.starveMs += interval;
        if (!hungry) {
          hungry = true;
          stats.underruns++;
          rebufferWanted = true;
        }
      } else {
        hungry = false;
      }
    }
    return interval;
  };

  const pump = () => {
    if (len === 0 || aborted) {
      return;
    }
    const inHand = len / Math.max(1, rate);
    if (!armed) {
      if (inHand < jitterTarget()) {
        return;
      }
      armed = true;
    }
    if (rebuffering) {
      if (inHand < jitterTarget()) {
        // Holding: the buffer is not rebuilt yet, so nothing goes out.
        return;
      }
      rebuffering = false;
      hungry = false;
    }
    for (;;) {
      const cut = findCut(buf, len, rate, {
        // The first piece carries the jitter buffer itself; after that a piece is
        // as short as a phrase.
        minSamples: Math.round(
          (stats.segments === 0 ? jitterTarget() : minSeconds) * rate,
        ),
        capSamples: Math.round(maxSeconds * rate),
        marks: markPositions(),
      });
      if (!cut) {
        return;
      }
      emit(cut.at, cut.forced);
      if (rebufferWanted) {
        // This cut is a boundary: say what has been said, then hold the rest back
        // until there is enough in hand to say it without breaking.
        rebufferWanted = false;
        rebuffering = true;
        growth = Math.min(maxJitter / minJitter, growth * REBUFFER_GROWTH);
        stats.rebuffers++;
        return;
      }
      if (len === 0) {
        return;
      }
    }
  };

  return {
    push(samples, sampleRate) {
      if (aborted || samples.length === 0) {
        return;
      }
      rate = sampleRate || rate || 24000;
      const interval = watchPace();
      const madeMs = (samples.length / rate) * 1000;
      stats.seconds += madeMs / 1000;
      chunks++;
      // A moving average over the chunks themselves. The gap before the very
      // first sample is the engine getting started, not a rate, so it is never
      // counted: a reply that begins slowly and then runs fast is not a slow one.
      if (chunks > 1 && interval > 0 && madeMs > 0) {
        const instant = interval / madeMs;
        stats.rtf =
          stats.rtf === 0 ? instant : stats.rtf + (instant - stats.rtf) * 0.3;
      }
      append(samples);
      if (
        allowHandoff &&
        !handoff &&
        playStartMs > 0 &&
        Date.now() - playStartMs > SLOW_SPEECH_AFTER_MS &&
        stats.rtf > SLOW_SPEECH_RTF
      ) {
        handoff = true;
      }
      pump();
    },

    handoffOffered() {
      if (!handoff) {
        return false;
      }
      handoff = false;
      return true;
    },

    /**
     * The words the ear has not had, on the only map there is: the reply read
     * at a steady pace. A handoff stops the engine, so the audio it made is the
     * audio it got through, and the rest of the text is what follows it.
     */
    remainingText() {
      const heard = handedOver / Math.max(1, rate);
      const whole = Math.max(heard, plannedSeconds);
      const at = Math.round((heard / Math.max(0.001, whole)) * text.length);
      return text.slice(Math.min(at, text.length));
    },

    abort(reason) {
      if (aborted) {
        return;
      }
      aborted = true;
      bargeIn = true;
      len = 0;
      sink.abort(reason);
      logPerf('speech.stream.abort', {reason, ...summary(stats)});
    },

    async close() {
      if (!aborted) {
        // Whatever is left is the end of this reply, however short: dropping it
        // to keep the pieces even would cut off the last word.
        if (len > 0) {
          emit(len, false);
        }
        const out = await sink.end();
        stats.sinkMode = out.mode;
        stats.gapMs = out.gapMs;
        stats.gapMaxMs = out.gapMaxMs;
        stats.dryMs = out.dryMs;
        stats.nativeUnderruns = out.nativeUnderruns;
        stats.bridgeMs = out.bridgeMs;
        stats.underruns += out.underruns;
        stats.playError = out.error;
      }
      stats.totalMs = Date.now() - t0;
      stats.slow = stats.rtf > SLOW_SPEECH_RTF;
      stats.played = handedOver > 0 && !stats.playError && !bargeIn;
      logPerf('speech.stream', {
        ...summary(stats),
        mode: stats.sinkMode,
        gap: Math.round(stats.gapMs),
        gapMax: Math.round(stats.gapMaxMs),
        dry: Math.round(stats.dryMs),
        nund: stats.nativeUnderruns,
        bridge: Math.round(stats.bridgeMs),
        ms: stats.totalMs,
        played: stats.played,
        slow: stats.slow,
        rate,
      });
      return stats;
    },
  };
};

/** The numbers a streamed reply is read against; short enough for one line. */
const summary = (stats: SpeechFeedStats) => ({
  seg: stats.segments,
  secs: Number(stats.seconds.toFixed(2)),
  und: stats.underruns,
  reb: stats.rebuffers,
  forced: stats.forced,
  jitter: Math.round(stats.jitterMs),
  starve: Math.round(stats.starveMs),
  rtf: Number(stats.rtf.toFixed(2)),
  firstMs: stats.firstPlayMs,
});

import {neuralAudioPlayer} from '@pocketpalai/react-native-speech/engine-sdk';

import {logPerf} from '../../utils/mediaPerf';

/**
 * The model's speech decoder hands out audio frame by frame, but the device
 * player takes one buffer and plays it to the end: `playAudio` resolves when the
 * clip is over, a second call truncates the first, and there is no queue. So
 * hearing a reply as it is synthesized means cutting the stream into pieces the
 * player can swallow one after another, and every cut is a place where a gap
 * can be heard.
 *
 * Two rules follow from that. Nothing plays until there is a jitter buffer of
 * audio in hand, because the player must not run dry between two pieces. And a
 * piece is cut at a quiet point, not at a fixed length, so the gap the cut
 * leaves falls inside a pause the speaker was going to make anyway.
 */

/** Audio held back before the first piece plays. */
export const DEFAULT_JITTER_SECONDS = 0.8;

/**
 * How long a piece may grow when no quiet point turns up. Past this the buffer
 * is worth the risk of a cut mid-word, because the alternative is holding a
 * whole sentence back and losing the point of streaming.
 */
export const DEFAULT_MAX_SEGMENT_SECONDS = 2.5;

/** The window the energy of the stream is measured over. */
const QUIET_FRAME_MS = 20;

/** Silence this long is a pause the ear is already expecting. */
const QUIET_RUN_FRAMES = 2;

/**
 * RMS below this is a pause. Speech sits well above it and the decoder's own
 * silence sits well below, so the exact value is not delicate; what matters is
 * that a cut lands where the waveform is flat rather than inside a vowel.
 */
const QUIET_RMS = 0.01;

export interface SpeechFeedStats {
  /** Pieces handed to the player. */
  segments: number;
  /** Seconds of audio the feed saw. */
  seconds: number;
  /** Times the player went dry while the engine was still working. */
  underruns: number;
  /** Cuts made at the length cap with no pause to cut at. */
  forced: number;
  /** Call start to the first sample reaching the player. */
  firstPlayMs: number;
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
}

const emptyStats = (): SpeechFeedStats => ({
  segments: 0,
  seconds: 0,
  underruns: 0,
  forced: 0,
  firstPlayMs: 0,
  playError: '',
  played: false,
});

/**
 * Where to cut `buf`, or -1 when nothing may be cut yet.
 *
 * A cut is the midpoint of a silence run, so the pause is split between the
 * piece that ends and the piece that follows, and the gap the player leaves is
 * covered on both sides. A run that reaches the end of the buffer cannot be
 * measured yet, so the whole buffer goes — trailing silence is the best cut
 * there is. Only when the cap is reached with no pause in sight is a piece cut
 * somewhere the speaker did not mean to stop.
 */
const findCut = (
  buf: Float32Array,
  len: number,
  sampleRate: number,
  jitterSeconds: number,
  maxSeconds: number,
): {at: number; forced: boolean} | null => {
  const floor = Math.min(len, Math.round(jitterSeconds * sampleRate));
  const cap = Math.round(maxSeconds * sampleRate);
  const frame = Math.max(1, Math.round((sampleRate * QUIET_FRAME_MS) / 1000));
  if (len < floor) {
    return null;
  }
  // Only a whole frame is measured: a partial one at the end of the buffer
  // averages samples that are not there yet into a run that is not there.
  let runStart = -1;
  let runFrames = 0;
  for (
    let start = floor - (floor % frame);
    start + frame <= len;
    start += frame
  ) {
    let sum = 0;
    for (let i = start; i < start + frame; i++) {
      const s = buf[i]!;
      sum += s * s;
    }
    const quiet = Math.sqrt(sum / frame) < QUIET_RMS;
    if (quiet) {
      if (runFrames === 0) {
        runStart = start;
      }
      runFrames++;
      continue;
    }
    if (runFrames >= QUIET_RUN_FRAMES) {
      return {
        at: runStart + Math.round((runFrames * frame) / 2),
        forced: false,
      };
    }
    runFrames = 0;
  }
  if (runFrames >= QUIET_RUN_FRAMES) {
    return {at: len, forced: false};
  }
  if (len >= cap) {
    return {at: cap, forced: true};
  }
  return null;
};

/**
 * Start feeding one reply's audio to the player.
 *
 * The feed owns the piece boundary and the playback queue; the caller owns the
 * engine. Chunks arrive from a native callback thread-hopping onto the JS
 * thread, so nothing here may block: the queue is drained by one loop that
 * waits on the player, and every push only appends and possibly enqueues.
 */
export const openSpeechFeed = (options?: {
  jitterSeconds?: number;
  maxSegmentSeconds?: number;
}): SpeechFeed => {
  const jitterSeconds = options?.jitterSeconds ?? DEFAULT_JITTER_SECONDS;
  const maxSeconds = options?.maxSegmentSeconds ?? DEFAULT_MAX_SEGMENT_SECONDS;
  const t0 = Date.now();

  // One growable buffer holds the audio not yet cut into a piece. Copies are
  // whole-buffer `copyWithin`, so a reply costs one allocation per doubling.
  let buf = new Float32Array(48000);
  let len = 0;
  let rate = 0;

  const queue: Array<{samples: Float32Array; seconds: number}> = [];
  let closed = false;
  let aborted = false;
  let wake: (() => void) | null = null;

  const stats = emptyStats();
  let started = false;
  /** Set by `abort`, so a reply cut short is not reported as heard. */
  let bargeIn = false;

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

  /** Hand `[0, at)` to the player and keep the rest for the next piece. */
  const cut = (at: number, forced: boolean) => {
    if (at <= 0 || len === 0) {
      return;
    }
    const take = Math.min(at, len);
    const samples = buf.slice(0, take);
    buf.copyWithin(0, take, len);
    len -= take;
    stats.forced += forced ? 1 : 0;
    queue.push({samples, seconds: take / Math.max(1, rate)});
    stats.segments++;
    const resume = wake;
    wake = null;
    resume?.();
  };

  const consume = async () => {
    for (;;) {
      if (aborted) {
        break;
      }
      const piece = queue.shift();
      if (!piece) {
        // `close` queues the tail before it closes, so an empty queue with the
        // stream closed really is the end of the reply.
        if (closed) {
          break;
        }
        // Nothing to play and more may still come. Counting it only once
        // playback is under way is what makes this an underrun and not the
        // ordinary wait for the first piece of the reply.
        if (started) {
          stats.underruns++;
        }
        await new Promise<void>(resolve => {
          wake = resolve;
        });
        continue;
      }
      if (!started) {
        started = true;
        stats.firstPlayMs = Date.now() - t0;
      }
      try {
        await neuralAudioPlayer.play(
          {
            samples: piece.samples,
            sampleRate: rate,
            channels: 1,
            duration: piece.seconds,
          },
          {ducking: true},
        );
      } catch (err) {
        stats.playError = err instanceof Error ? err.message : String(err);
        console.warn('[voice] streamed speech playback failed:', err);
        aborted = true;
      }
    }
  };

  const drain = consume();

  return {
    push(samples, sampleRate) {
      if (aborted || samples.length === 0) {
        return;
      }
      rate = sampleRate || rate || 24000;
      stats.seconds += samples.length / rate;
      append(samples);
      const cutPoint = findCut(buf, len, rate, jitterSeconds, maxSeconds);
      if (cutPoint) {
        cut(cutPoint.at, cutPoint.forced);
      }
    },

    abort(reason) {
      if (aborted) {
        return;
      }
      aborted = true;
      bargeIn = true;
      closed = true;
      len = 0;
      queue.length = 0;
      const resume = wake;
      wake = null;
      resume?.();
      // Only a reply the ear already started losing has something to stop;
      // a feed that never filled its buffer must not cut off other audio.
      if (started) {
        neuralAudioPlayer.stop().catch(err => {
          console.warn('[voice] streamed speech stop failed:', err);
        });
      }
      logPerf('speech.stream.abort', {reason, ...summary(stats)});
    },

    async close() {
      if (!aborted) {
        // Whatever is left is the end of this reply, however short: dropping it
        // to keep the pieces even would cut off the last word.
        if (len > 0) {
          cut(len, false);
        }
        closed = true;
        const resume = wake;
        wake = null;
        resume?.();
      }
      await drain;
      stats.played = started && !stats.playError && !bargeIn;
      logPerf('speech.stream', {
        ...summary(stats),
        played: stats.played,
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
  forced: stats.forced,
  firstMs: stats.firstPlayMs,
});

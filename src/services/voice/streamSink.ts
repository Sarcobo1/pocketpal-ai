import {fromByteArray} from 'base64-js';
import {neuralAudioPlayer} from '@pocketpalai/react-native-speech/engine-sdk';
import {Platform} from 'react-native';

import NativeSpeechStream from '../../specs/NativeSpeechStream';
import type {SpeechStreamStats} from '../../specs/NativeSpeechStream';

/**
 * How the samples of one spoken reply reach the ear.
 *
 * Two ways, behind one interface:
 *
 * - `stream`: one output stream, opened for the whole reply. Chunks are appended
 *   to it as the model makes them and the ear hears one continuous voice — there
 *   is no boundary in the audio to hear at all.
 * - `pieces`: each chunk goes through the system player, which builds a fresh
 *   output for every call. That rebuild is audible — piece, hole, piece — so this
 *   is the path a device without stream output falls back to, and it is measured
 *   exactly like the path that replaced it.
 *
 * Both report the milliseconds the output path itself took away from the reply.
 * That is the number which tells a stuttering player apart from an engine that
 * simply cannot synthesize faster than the ear can listen.
 */

/** A hole this long is heard as a hesitation, not as a pause in the speech. */
const AUDIBLE_GAP_MS = 60;

export type SinkMode = 'stream' | 'pieces';

export interface VoiceSinkStats {
  /** Which path actually carried the reply. */
  mode: SinkMode;
  /** Chunks handed to the output. */
  segments: number;
  /** Times the output ran dry, or broke between two chunks. */
  underruns: number;
  /** The device's own count, or -1 when it would not say. */
  nativeUnderruns: number;
  /** Milliseconds the output had nothing to play. */
  dryMs: number;
  /** Milliseconds of audible holes this path caused. */
  gapMs: number;
  /** The worst single hole, in milliseconds. */
  gapMaxMs: number;
  /** Milliseconds spent crossing the bridge, for a stream. */
  bridgeMs: number;
  /** The output's own refusal, when it said one. */
  error: string;
  /**
   * Milliseconds of speech this sink was handed, at the rate it was handed at:
   * samples over rate, which is all the ear is owed.
   */
  audioMs: number;
  /**
   * Wall milliseconds the output spent sounding it. Against `audioMs` this is
   * the playback ratio — the number that says a 24 kHz clip really took the
   * 24 kHz it was written for, rather than being stretched or cut short on the
   * way out. For a stream it is the device's own clock; for pieces it is the
   * player calls, so it includes the time each call took to open and close.
   */
  playedMs: number;
  /** Milliseconds the output took in, for a stream: `audioMs` minus this is loss. */
  writtenMs: number;
  /** The rate the output was opened at. */
  sampleRate: number;
  /** Chunks that came at another rate than the one the output was opened at. */
  rateMismatch: number;
}

export interface VoiceSink {
  /** Queue one chunk of mono float speech. Never blocks. */
  write(samples: Float32Array, sampleRate: number): void;
  /** No more audio: let the tail play out and report what it cost. */
  end(): Promise<VoiceSinkStats>;
  /** Silence at once — a barge-in does not wait for the tail of a reply. */
  abort(reason: string): void;
}

const emptyStats = (mode: SinkMode): VoiceSinkStats => ({
  mode,
  segments: 0,
  underruns: 0,
  nativeUnderruns: -1,
  dryMs: 0,
  gapMs: 0,
  gapMaxMs: 0,
  bridgeMs: 0,
  error: '',
  audioMs: 0,
  playedMs: 0,
  writtenMs: 0,
  sampleRate: 0,
  rateMismatch: 0,
});

/** Milliseconds of speech `samples` carries at `sampleRate`. */
const audioMs = (samples: number, sampleRate: number): number =>
  (samples / Math.max(1, sampleRate)) * 1000;

/**
 * Float32 speech as the 16-bit bytes an output stream wants.
 *
 * Clipping is deliberate: the decoder overshoots on an occasional plosive, and a
 * sample that wraps around clicks far louder than one held at full scale.
 */
const toInt16Bytes = (samples: Float32Array): Uint8Array => {
  const bytes = new Uint8Array(samples.length * 2);
  const pcm = new Int16Array(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    pcm[i] = v < 0 ? v * 32768 : v * 32767;
  }
  return bytes;
};

/** Every chunk its own player call, one after another, never two at once. */
class PieceSink implements VoiceSink {
  readonly stats = emptyStats('pieces');
  private queue: Array<{samples: Float32Array; sampleRate: number}> = [];
  private closed = false;
  private started = false;
  private lastEnd = 0;
  private wake: (() => void) | null = null;
  private drain: Promise<void>;

  constructor() {
    this.drain = this.consume();
  }

  write(samples: Float32Array, sampleRate: number): void {
    if (this.stats.error || samples.length === 0) {
      return;
    }
    this.queue.push({samples, sampleRate});
    const resume = this.wake;
    this.wake = null;
    resume?.();
  }

  async end(): Promise<VoiceSinkStats> {
    this.closed = true;
    const resume = this.wake;
    this.wake = null;
    resume?.();
    await this.drain;
    return this.stats;
  }

  abort(reason: string): void {
    if (this.stats.error) {
      return;
    }
    this.stats.error = reason;
    this.closed = true;
    this.queue.length = 0;
    const resume = this.wake;
    this.wake = null;
    resume?.();
    // Only a reply the ear already started losing has something to stop; a sink
    // that never filled the player must not cut off somebody else's audio.
    if (this.started) {
      neuralAudioPlayer.stop().catch(err => {
        console.warn('[voice] streamed speech stop failed:', err);
      });
    }
  }

  private hole(ms: number): void {
    if (ms > AUDIBLE_GAP_MS) {
      this.stats.gapMs += ms;
      this.stats.gapMaxMs = Math.max(this.stats.gapMaxMs, ms);
      this.stats.underruns++;
    }
  }

  private async consume(): Promise<void> {
    for (;;) {
      const piece = this.queue.shift();
      if (!piece) {
        if (this.closed || this.stats.error) {
          return;
        }
        await new Promise<void>(resolve => {
          this.wake = resolve;
        });
        continue;
      }
      this.started = true;
      const pieceMs = audioMs(piece.samples.length, piece.sampleRate);
      if (!this.stats.sampleRate) {
        this.stats.sampleRate = piece.sampleRate;
      } else if (piece.sampleRate !== this.stats.sampleRate) {
        // This path opens a player per piece, so a second rate is a second pitch
        // rather than a broken reply — but a reply that changes rate mid-clip is
        // exactly what the slow-voice report has to rule out, so it is counted.
        this.stats.rateMismatch++;
      }
      const t0 = Date.now();
      if (this.lastEnd) {
        this.hole(t0 - this.lastEnd);
      }
      try {
        await neuralAudioPlayer.play(
          {
            samples: piece.samples,
            sampleRate: piece.sampleRate,
            channels: 1,
            duration: piece.samples.length / piece.sampleRate,
          },
          {ducking: true},
        );
      } catch (err) {
        this.stats.error = err instanceof Error ? err.message : String(err);
        console.warn('[voice] streamed speech playback failed:', err);
        return;
      }
      const end = Date.now();
      this.stats.segments++;
      this.stats.audioMs += pieceMs;
      this.stats.playedMs += end - t0;
      this.lastEnd = end;
      // The call returns when the clip is over, so whatever it took beyond the
      // audio it carried was spent opening and closing that clip — which is the
      // hole between two pieces, measured instead of assumed.
      this.hole(end - t0 - pieceMs);
    }
  }
}

/**
 * One stream the whole reply is appended to, already opened by the sink that
 * owns it.
 */
class StreamSink implements VoiceSink {
  readonly stats = emptyStats('stream');
  private tail: Promise<void> = Promise.resolve();
  private closed = false;

  /** A barge-in: queued audio is stale, so the chunks still on the chain drop. */
  private abandoned = false;
  private native: {
    underruns: number;
    dryMs: number;
    wallMs: number;
    framesWritten: number;
  } | null = null;

  /**
   * Opened at the rate of the chunk that arrived first: the stream takes one rate
   * for the whole reply, so every later chunk is measured against it.
   */
  constructor(sampleRate: number) {
    this.stats.sampleRate = sampleRate;
  }

  write(samples: Float32Array, sampleRate: number): void {
    if (this.closed || samples.length === 0) {
      return;
    }
    this.stats.audioMs += audioMs(samples.length, this.stats.sampleRate);
    if (sampleRate !== this.stats.sampleRate) {
      // The track was built for one rate and plays everything at it, so a chunk
      // made at another is heard at the wrong pitch for its whole length.
      this.stats.rateMismatch++;
    }
    const base64 = fromByteArray(toInt16Bytes(samples));
    // Ordered, and never waiting on the device: the stream keeps its own buffer,
    // so a chunk is handed over as fast as the bridge will take it.
    this.tail = this.tail.then(() => this.deliver(base64));
  }

  private async deliver(base64: string): Promise<void> {
    const native = NativeSpeechStream;
    // Ending is not refusing: a chunk the reply already committed to play is
    // still owed to the stream, and native.end is queued behind it for that
    // reason. Only a barge-in or a refusal the stream already said cancels it.
    if (!native || this.abandoned || this.stats.error) {
      return;
    }
    const t0 = Date.now();
    const accepted = await native.write(base64).catch(() => false);
    this.stats.bridgeMs += Date.now() - t0;
    if (!accepted) {
      this.stats.error = this.stats.error || 'stream-closed';
      return;
    }
    this.stats.segments++;
  }

  async end(): Promise<VoiceSinkStats> {
    if (!this.abandoned) {
      this.tail = this.tail.then(async () => {
        const native = NativeSpeechStream;
        if (!native) {
          return;
        }
        this.native = toStats(await native.end().catch(() => null));
      });
    }
    this.closed = true;
    await this.tail;
    this.applyNative();
    return this.stats;
  }

  abort(reason: string): void {
    if (this.abandoned) {
      return;
    }
    this.abandoned = true;
    this.stats.error = this.stats.error || reason;
    this.closed = true;
    this.tail = this.tail.then(async () => {
      const native = NativeSpeechStream;
      if (!native) {
        return;
      }
      await native.abort().catch(() => false);
      this.native = toStats(await native.end().catch(() => null));
      this.applyNative();
    });
  }

  private applyNative(): void {
    if (!this.native) {
      return;
    }
    this.stats.dryMs = this.native.dryMs;
    this.stats.gapMs = this.native.dryMs;
    this.stats.nativeUnderruns = this.native.underruns;
    this.stats.playedMs = this.native.wallMs;
    this.stats.writtenMs = audioMs(
      this.native.framesWritten,
      this.stats.sampleRate,
    );
    if (this.native.underruns >= 0) {
      this.stats.underruns = this.native.underruns;
    }
  }
}

/** The device's answer, or nothing when it did not give one. */
const toStats = (
  stats: SpeechStreamStats | null,
): {
  underruns: number;
  dryMs: number;
  wallMs: number;
  framesWritten: number;
} | null =>
  stats && {
    underruns: stats.underruns,
    dryMs: stats.dryMs,
    // A track built before these two were reported answers without them: the
    // ratio then reads as "the device would not say", not as a clip of no length.
    wallMs: stats.wallMs || 0,
    framesWritten: stats.framesWritten || 0,
  };

/**
 * The output a streamed reply is heard through.
 *
 * Whether this device will take a continuous stream is only known once the
 * stream has been asked for, and that happens on the first chunk — so chunks
 * before the answer are held, not played. Nothing has been heard yet at that
 * point, so waiting costs a reply nothing.
 */
class SpeechSink implements VoiceSink {
  private inner: VoiceSink | null = null;
  private deciding: Promise<void> | null = null;
  private held: Array<{samples: Float32Array; sampleRate: number}> = [];

  /** The reply is over: what is in hand still gets played. */
  private closed = false;

  /** A barge-in took the output away: nothing in hand is still wanted. */
  private abandoned = false;
  private reason = '';

  constructor(private readonly allowStream: boolean) {}

  write(samples: Float32Array, sampleRate: number): void {
    if (this.closed || samples.length === 0) {
      return;
    }
    if (this.inner) {
      this.inner.write(samples, sampleRate);
      return;
    }
    this.held.push({samples, sampleRate});
    if (!this.deciding) {
      this.deciding = this.decide(sampleRate);
    }
  }

  private async decide(sampleRate: number): Promise<void> {
    const native = NativeSpeechStream;
    let stream = false;
    if (this.allowStream && native) {
      stream = await native
        .begin(sampleRate, 1, true)
        .then(ok => ok === true)
        .catch(() => false);
    }
    const inner: VoiceSink = stream
      ? new StreamSink(sampleRate)
      : new PieceSink();
    this.inner = inner;
    const held = this.held;
    this.held = [];
    if (this.abandoned) {
      // Interrupted before the answer. Nothing more goes into it, and the sink
      // gives the output back — a stream sink aborts the stream it was opened on.
      inner.abort(this.reason);
      return;
    }
    // The answer arrives a beat after the audio, so a short reply is normally
    // already over by now. Its pieces were held, not thrown away: they are the
    // whole reply, and a listener who never interrupted should hear all of it.
    for (const chunk of held) {
      inner.write(chunk.samples, chunk.sampleRate);
    }
  }

  async end(): Promise<VoiceSinkStats> {
    this.closed = true;
    await this.deciding;
    const inner = this.inner;
    if (!inner) {
      // A reply with nothing to say is not a playback failure.
      return emptyStats(this.allowStream ? 'stream' : 'pieces');
    }
    return inner.end();
  }

  abort(reason: string): void {
    this.reason = reason;
    this.abandoned = true;
    this.closed = true;
    this.held = [];
    if (this.inner) {
      this.inner.abort(reason);
    }
    // A decision still in the air hands the abort to the sink as soon as it
    // exists, so a barge-in never has to wait for the answer to be silent.
    void this.deciding?.then(() => {
      if (this.inner) {
        this.inner.abort(reason);
      }
    });
  }
}

/**
 * Open the output for one streamed reply.
 *
 * No stream module, or a caller that asked for the old behaviour, both mean the
 * same thing here: chunks are played one after another.
 */
export const openVoiceSink = (options?: {allowStream?: boolean}): VoiceSink => {
  const allowStream =
    options?.allowStream ??
    (Platform.OS === 'android' && NativeSpeechStream !== null);
  return new SpeechSink(allowStream);
};

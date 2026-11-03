import {fromByteArray} from 'base64-js';
import {neuralAudioPlayer} from '@pocketpalai/react-native-speech/engine-sdk';
import {Platform} from 'react-native';

import NativeSpeechStream from '../../specs/NativeSpeechStream';

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
});

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
      const pieceMs =
        (piece.samples.length / Math.max(1, piece.sampleRate)) * 1000;
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
  private native: {underruns: number; dryMs: number} | null = null;

  write(samples: Float32Array): void {
    if (this.closed || samples.length === 0) {
      return;
    }
    const base64 = fromByteArray(toInt16Bytes(samples));
    // Ordered, and never waiting on the device: the stream keeps its own buffer,
    // so a chunk is handed over as fast as the bridge will take it.
    this.tail = this.tail.then(() => this.deliver(base64));
  }

  private async deliver(base64: string): Promise<void> {
    const native = NativeSpeechStream;
    if (!native || this.closed || this.stats.error) {
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
    this.tail = this.tail.then(async () => {
      const native = NativeSpeechStream;
      if (!native) {
        return;
      }
      const stats = await native.end().catch(() => null);
      if (stats) {
        this.native = {underruns: stats.underruns, dryMs: stats.dryMs};
      }
    });
    this.closed = true;
    await this.tail;
    this.applyNative();
    return this.stats;
  }

  abort(reason: string): void {
    this.stats.error = this.stats.error || reason;
    this.closed = true;
    this.tail = this.tail.then(async () => {
      const native = NativeSpeechStream;
      if (!native) {
        return;
      }
      await native.abort().catch(() => false);
      const stats = await native.end().catch(() => null);
      if (stats) {
        this.native = {underruns: stats.underruns, dryMs: stats.dryMs};
        this.applyNative();
      }
    });
  }

  private applyNative(): void {
    if (!this.native) {
      return;
    }
    this.stats.dryMs = this.native.dryMs;
    this.stats.gapMs = this.native.dryMs;
    this.stats.nativeUnderruns = this.native.underruns;
    if (this.native.underruns >= 0) {
      this.stats.underruns = this.native.underruns;
    }
  }
}

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
  private closed = false;
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
    const inner: VoiceSink = stream ? new StreamSink() : new PieceSink();
    this.inner = inner;
    const held = this.held;
    this.held = [];
    if (this.closed) {
      // Interrupted before the answer. Nothing more goes into it, and the sink
      // gives the output back — a stream sink aborts the stream it was opened on.
      inner.abort(this.reason);
      return;
    }
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
    this.closed = true;
    this.held = [];
    if (this.inner) {
      this.inner.abort(reason);
      return;
    }
    this.deciding?.then(() => {
      this.inner?.abort(reason);
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

import {
  ASR_MAX_SEGMENT_MS,
  ASR_SAMPLE_RATE,
  ASR_SEGMENT_LEAD_IN_MS,
} from '../asr/constants';

import {logPerf} from '../../utils/mediaPerf';
import {vtrace} from '../../utils/voiceTrace';

import {
  VOICE_ENDPOINT_HANG_MS,
  VOICE_VAD_CALIBRATE_MS,
  VOICE_VAD_MIN_SPEECH_MS,
  VOICE_VAD_NOISE_LEAK,
  VOICE_VAD_NOISE_RISE,
  VOICE_VAD_TAIL_MS,
  VOICE_VAD_TRACK_MIN_RMS,
} from './constants';
import {pcmLevel, vadFloors} from './speechLevel';
import type {VadFloors} from './speechLevel';

const BYTES_PER_MS = (ASR_SAMPLE_RATE * 2) / 1000;
const CALIBRATE_BYTES = VOICE_VAD_CALIBRATE_MS * BYTES_PER_MS;
const HANG_BYTES = VOICE_ENDPOINT_HANG_MS * BYTES_PER_MS;

/** One captured chunk, with the loudness that decided what to do with it. */
type Entry = {pcm: Uint8Array; rms: number};

/**
 * Finds the end of one spoken utterance in a live 16-bit PCM stream.
 *
 * A chunk counts as speech when its RMS stands a multiple of the room tone
 * above it, and an utterance only opens after that speech runs
 * `VOICE_VAD_MIN_SPEECH_MS` without a break. The room tone is measured, not
 * assumed: the first `VOICE_VAD_CALIBRATE_MS` of every capture is read as the
 * room, because the recorder that feeds this has automatic gain, and a fixed
 * threshold is what used to sell silence as speech. Speech has to beat the
 * onset level to open an utterance and only the lower `hold` level to stay in
 * one, so a soft final syllable does not read as the pause that closes it.
 *
 * Audio that is too short or too quiet to be speech is thrown away instead of
 * left in the buffer: it used to ride into the next utterance, so the model
 * heard a minute of room tone in place of a question.
 */
export class Endpointer {
  private entries: Entry[] = [];
  private bytes = 0;
  private silentBytes = 0;
  private runBytes = 0;
  private speechBytes = 0;
  private started = false;

  /** Room tone estimate, in RMS, learned from the chunks that are not speech. */
  private noise = VOICE_VAD_TRACK_MIN_RMS;

  /** Capture audio read as the room, and the quietest chunk of it so far. */
  private calibratedBytes = 0;
  private calibMin = Infinity;

  /** True once a contiguous run long enough to be speech was heard. */
  get hasSpeech(): boolean {
    return this.started;
  }

  /** The longest voiced run in the buffer so far (ms). */
  get voicedMs(): number {
    return Math.round(this.speechBytes / BYTES_PER_MS);
  }

  /** The levels the next chunk is measured against. */
  get floors(): VadFloors {
    return vadFloors(this.noise);
  }

  push(chunk: Uint8Array): 'none' | 'endpoint' {
    const {rms} = pcmLevel(chunk);
    const {onset, hold} = this.floors;
    const {noise, calibrated} = this.learn(chunk.length, rms, onset);
    this.entries.push({pcm: chunk, rms});
    this.bytes += chunk.length;

    const voiced = rms >= (this.started ? hold : onset);
    if (voiced) {
      this.silentBytes = 0;
      if (!this.started) {
        this.runBytes += chunk.length;
        this.speechBytes = Math.max(this.speechBytes, this.runBytes);
        if (calibrated && this.voicedMs >= VOICE_VAD_MIN_SPEECH_MS) {
          this.started = true;
          vtrace('vad.start', {rms, onset, hold, speechMs: this.voicedMs});
        }
      }
    } else {
      this.runBytes = 0;
      this.silentBytes += chunk.length;
    }

    if (!this.started) {
      if (this.silentBytes < HANG_BYTES) {
        this.trimLeadIn();
        return 'none';
      }
      if (this.speechBytes > 0) {
        // Both sinks: the trace lines up with the session, the console line is
        // what a release APK on a phone that never sent the clip can show.
        logPerf('utt.drop', {
          reason: 'short',
          speechMs: this.voicedMs,
          ms: Math.round(this.bytes / BYTES_PER_MS),
          rms: Math.round(rms * 1e4) / 1e4,
          onset: Math.round(onset * 1e4) / 1e4,
          hold: Math.round(hold * 1e4) / 1e4,
        });
        vtrace('vad.drop', {reason: 'short', rms, onset, hold, noise});
      }
      this.clear();
      return 'none';
    }

    const paused = this.silentBytes >= HANG_BYTES;
    const tooLong = this.bytes >= ASR_MAX_SEGMENT_MS * BYTES_PER_MS;
    if (paused || tooLong) {
      vtrace('vad.end', {
        by: paused ? 'pause' : 'max',
        ms: Math.round(this.bytes / BYTES_PER_MS),
        speechMs: this.voicedMs,
        onset,
        hold,
        noise,
      });
      return 'endpoint';
    }
    return 'none';
  }

  /** A manual endpoint: true when there is speech to send. */
  tap(): boolean {
    return this.hasSpeech;
  }

  /** The buffered utterance, without the silence that followed it. */
  take(): Uint8Array {
    this.trimTail();
    const pcm = new Uint8Array(this.bytes);
    let offset = 0;
    for (const entry of this.entries) {
      pcm.set(entry.pcm, offset);
      offset += entry.pcm.length;
    }
    this.clear();
    return pcm;
  }

  /**
   * Called every time the mic opens: the buffered audio goes and the room is
   * measured again, since a phone that was silent on a desk is in a hand, in a
   * different room, by the next turn.
   */
  reset(): void {
    this.clear();
    this.calibratedBytes = 0;
    this.calibMin = Infinity;
  }

  /**
   * Reads one chunk into the room tone estimate. The calibration window takes
   * the quietest chunk it sees, at any level: speech that starts immediately
   * still leaves a dip, and a hiss that starts immediately is the room. After
   * that only sub-onset chunks move the estimate, fast downward and slowly
   * upward, so a word cannot raise the floor under itself.
   */
  private learn(
    bytes: number,
    rms: number,
    onset: number,
  ): {noise: number; calibrated: boolean} {
    if (this.calibratedBytes < CALIBRATE_BYTES) {
      this.calibratedBytes += bytes;
      this.calibMin = Math.min(this.calibMin, rms);
      if (this.calibratedBytes >= CALIBRATE_BYTES) {
        this.noise = Math.max(VOICE_VAD_TRACK_MIN_RMS, this.calibMin);
        vtrace('vad.calibrate', {noise: this.noise, ...vadFloors(this.noise)});
      }
      return {noise: this.noise, calibrated: false};
    }
    if (rms < onset) {
      this.noise +=
        (rms - this.noise) *
        (rms < this.noise ? VOICE_VAD_NOISE_LEAK : VOICE_VAD_NOISE_RISE);
    }
    return {noise: this.noise, calibrated: true};
  }

  private clear(): void {
    this.entries = [];
    this.bytes = 0;
    this.runBytes = 0;
    this.speechBytes = 0;
    this.silentBytes = 0;
    this.started = false;
  }

  /** Caps the silence waiting for speech; a chunk of speech is never dropped. */
  private trimLeadIn(): void {
    if (this.speechBytes > 0) {
      return;
    }
    const keep = ASR_SEGMENT_LEAD_IN_MS * BYTES_PER_MS;
    while (
      this.entries.length > 1 &&
      this.bytes - this.entries[0]!.pcm.length >= keep
    ) {
      this.bytes -= this.entries.shift()!.pcm.length;
    }
  }

  /** Keeps `VOICE_VAD_TAIL_MS` of the pause that ended the utterance. */
  private trimTail(): void {
    const keep = VOICE_VAD_TAIL_MS * BYTES_PER_MS;
    const {hold} = this.floors;
    let silence = 0;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i]!;
      if (entry.rms >= hold) {
        break;
      }
      silence += entry.pcm.length;
    }
    let drop = Math.max(0, silence - keep);
    while (drop > 0 && this.entries.length > 1) {
      const last = this.entries[this.entries.length - 1]!;
      if (last.pcm.length > drop) {
        break;
      }
      this.entries.pop();
      this.bytes -= last.pcm.length;
      drop -= last.pcm.length;
    }
  }
}

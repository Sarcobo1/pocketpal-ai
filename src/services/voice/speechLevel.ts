import {ASR_SAMPLE_RATE, ASR_VAD_FRAME_MS} from '../asr/constants';
import {int16PcmToFloat32} from '../asr/energyVad';

import {
  VOICE_CLIP_MIN_RMS,
  VOICE_VAD_FLOOR_MAX_RMS,
  VOICE_VAD_FLOOR_MIN_RMS,
  VOICE_VAD_HOLD_FACTOR,
  VOICE_VAD_MIN_SPEECH_MS,
  VOICE_VAD_ONSET_FACTOR,
  VOICE_VAD_SENSITIVITY,
} from './constants';

/** Loudness of one buffer of little-endian int16 PCM, both in [0, 1]. */
export type PcmLevel = {rms: number; peak: number};

/** Why a captured utterance was not sent to the model. */
export type GateReason = 'pass' | 'short' | 'silent' | 'quiet';

/**
 * The two levels a chunk is measured against: `onset` opens and continues a
 * run of speech, the lower `hold` keeps an open utterance from ending on the
 * first soft syllable.
 */
export type VadFloors = {onset: number; hold: number};

/**
 * RMS and peak of a captured chunk. The peak matters because room tone and
 * quiet speech can share an RMS and only the peak tells them apart in a log.
 */
export const pcmLevel = (pcm: Uint8Array): PcmLevel => {
  const samples = int16PcmToFloat32(pcm);
  if (samples.length === 0) {
    return {rms: 0, peak: 0};
  }
  let sumSquares = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.abs(samples[i]!);
    sumSquares += samples[i]! * samples[i]!;
    if (s > peak) {
      peak = s;
    }
  }
  return {rms: Math.sqrt(sumSquares / samples.length), peak};
};

const frameSize = Math.round((ASR_SAMPLE_RATE * ASR_VAD_FRAME_MS) / 1000);

/** RMS per whole `ASR_VAD_FRAME_MS` frame; a partial tail frame is not counted. */
const frameLevels = (samples: Float32Array): number[] => {
  const out: number[] = [];
  for (let start = 0; start + frameSize <= samples.length; start += frameSize) {
    let sumSquares = 0;
    for (let i = 0; i < frameSize; i++) {
      const s = samples[start + i]!;
      sumSquares += s * s;
    }
    out.push(Math.sqrt(sumSquares / frameSize));
  }
  return out;
};

/** Length of the longest run of consecutive frames at or above `floor` (ms). */
export const speechRunMs = (samples: Float32Array, floor: number): number => {
  let best = 0;
  let run = 0;
  for (const level of frameLevels(samples)) {
    run = level >= floor ? run + 1 : 0;
    if (run > best) {
      best = run;
    }
  }
  return best * ASR_VAD_FRAME_MS;
};

const clampFloor = (noiseRms: number, factor: number): number =>
  Math.min(
    VOICE_VAD_FLOOR_MAX_RMS,
    Math.max(
      VOICE_VAD_FLOOR_MIN_RMS,
      (noiseRms * factor) / VOICE_VAD_SENSITIVITY,
    ),
  );

/**
 * The floors a chunk is measured against, from the room tone the endpointer
 * learned. They track the mic rather than a constant because a phone with the
 * gain up has a noise floor that crosses any fixed threshold — and a fixed
 * threshold is why silence used to buy an utterance.
 */
export const vadFloors = (noiseRms: number): VadFloors => ({
  onset: clampFloor(noiseRms, VOICE_VAD_ONSET_FACTOR),
  hold: clampFloor(noiseRms, VOICE_VAD_HOLD_FACTOR),
});

/**
 * The last sanity check on a finished utterance. The endpointer owns the
 * adaptive decision; this one only refuses to spend a model turn on a clip with
 * no speech-shaped energy in it at all, and reports the numbers that say why.
 */
export const gateUtterance = (
  pcm: Uint8Array,
): {
  pass: boolean;
  reason: GateReason;
  ms: number;
  bytes: number;
  rms: number;
  peak: number;
  speechMs: number;
  floor: number;
} => {
  const ms = Math.round((pcm.length / 2 / ASR_SAMPLE_RATE) * 1000);
  const {rms, peak} = pcmLevel(pcm);
  const base = {
    ms,
    bytes: pcm.length,
    rms: Number(rms.toFixed(4)),
    peak: Number(peak.toFixed(4)),
    floor: VOICE_CLIP_MIN_RMS,
  };
  if (ms < VOICE_VAD_MIN_SPEECH_MS) {
    return {...base, pass: false, reason: 'short', speechMs: 0};
  }
  if (rms < VOICE_CLIP_MIN_RMS) {
    return {...base, pass: false, reason: 'silent', speechMs: 0};
  }
  const speechMs = speechRunMs(int16PcmToFloat32(pcm), VOICE_CLIP_MIN_RMS);
  if (speechMs < VOICE_VAD_MIN_SPEECH_MS) {
    return {...base, pass: false, reason: 'quiet', speechMs};
  }
  return {...base, pass: true, reason: 'pass', speechMs};
};

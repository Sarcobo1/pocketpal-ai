import {ASR_CHUNK_BYTES, ASR_SEGMENT_LEAD_IN_MS} from '../../asr/constants';
import {Endpointer} from '../endpointer';
import {
  VOICE_VAD_CALIBRATE_MS,
  VOICE_VAD_FLOOR_MAX_RMS,
  VOICE_VAD_MIN_SPEECH_MS,
} from '../constants';

const CHUNK_MS = 50;

/** A chunk at `amplitude` RMS, wobbled so it is not a perfect square wave. */
const chunk = (amplitude: number, wobble = 0): Uint8Array => {
  const pcm = new Uint8Array(ASR_CHUNK_BYTES);
  const view = new DataView(pcm.buffer);
  for (let i = 0; i < ASR_CHUNK_BYTES / 2; i++) {
    const level = Math.min(
      1,
      Math.max(0, amplitude + Math.sin(i * 0.31) * wobble),
    );
    view.setInt16(i * 2, (i % 2 ? 1 : -1) * level * 0x7fff, true);
  }
  return pcm;
};
const voiced = () => chunk(0.1, 0.02);
const silent = () => chunk(0);
const hiss = () => chunk(0.02, 0.004);

const msOf = (pcm: Uint8Array) => (pcm.length / ASR_CHUNK_BYTES) * CHUNK_MS;

const pushFor = (
  endpointer: Endpointer,
  make: () => Uint8Array,
  ms: number,
): Array<'none' | 'endpoint'> =>
  Array.from({length: ms / CHUNK_MS}, () => endpointer.push(make()));

describe('Endpointer', () => {
  it('keeps only a short lead-in of silence before speech', () => {
    const endpointer = new Endpointer();
    pushFor(endpointer, silent, 2000);
    pushFor(endpointer, voiced, 500);
    endpointer.tap();

    const ms = msOf(endpointer.take());
    expect(ms).toBeLessThanOrEqual(ASR_SEGMENT_LEAD_IN_MS + 500 + CHUNK_MS);
    expect(ms).toBeGreaterThanOrEqual(500);
  });

  it('endpoints after 600 ms of silence that follows speech', () => {
    const endpointer = new Endpointer();
    pushFor(endpointer, voiced, 500);
    const results = pushFor(endpointer, silent, 600);

    expect(results.slice(0, -1)).not.toContain('endpoint');
    expect(results[results.length - 1]).toBe('endpoint');
  });

  it('does not endpoint on a pause after less than the minimum speech', () => {
    const endpointer = new Endpointer();
    pushFor(endpointer, voiced, 150);
    const results = pushFor(endpointer, silent, 2000);

    expect(results).not.toContain('endpoint');
    expect(endpointer.hasSpeech).toBe(false);
  });

  it('endpoints at the 25 s cap while speech goes on', () => {
    const endpointer = new Endpointer();
    const results = pushFor(endpointer, voiced, 25_000);

    expect(results.indexOf('endpoint')).toBe(results.length - 1);
  });

  it('a tap ends the utterance only once speech was heard', () => {
    const endpointer = new Endpointer();
    pushFor(endpointer, silent, 1000);
    expect(endpointer.tap()).toBe(false);

    pushFor(endpointer, voiced, 400);
    expect(endpointer.tap()).toBe(true);
    expect(endpointer.voicedMs).toBeGreaterThanOrEqual(VOICE_VAD_MIN_SPEECH_MS);
  });

  it.each([0.012, 0.02, 0.03])(
    'reads %s room tone as the room, not as speech',
    level => {
      const endpointer = new Endpointer();
      const results = pushFor(endpointer, () => chunk(level, level / 5), 8000);

      expect(results).not.toContain('endpoint');
      expect(msOf(endpointer.take())).toBeLessThanOrEqual(400);
    },
  );

  it('measures the room before it trusts the floor', () => {
    const endpointer = new Endpointer();
    pushFor(endpointer, hiss, VOICE_VAD_CALIBRATE_MS);

    expect(endpointer.floors.onset).toBeCloseTo(0.02 * 3, 1);
    expect(endpointer.floors.hold).toBeLessThan(endpointer.floors.onset);
  });

  it('never lets a loud room push the onset past the band', () => {
    const endpointer = new Endpointer();
    pushFor(endpointer, () => chunk(0.2, 0.05), VOICE_VAD_CALIBRATE_MS);

    expect(endpointer.floors.onset).toBe(VOICE_VAD_FLOOR_MAX_RMS);
  });

  it('takes speech that sits above the room tone it measured', () => {
    const endpointer = new Endpointer();
    pushFor(endpointer, hiss, 1000);
    pushFor(endpointer, () => chunk(0.12, 0.02), 800);
    const results = pushFor(endpointer, hiss, 700);

    expect(results).toContain('endpoint');
    const ms = msOf(endpointer.take());
    expect(ms).toBeGreaterThanOrEqual(800);
    expect(ms).toBeLessThanOrEqual(1300);
  });

  it('trims the pause that ended the utterance', () => {
    const endpointer = new Endpointer();
    pushFor(endpointer, voiced, 800);
    pushFor(endpointer, silent, 2000);

    expect(msOf(endpointer.take())).toBeLessThanOrEqual(1000);
  });

  it('starts over after take and reset', () => {
    const endpointer = new Endpointer();
    pushFor(endpointer, voiced, 500);
    expect(msOf(endpointer.take())).toBeGreaterThanOrEqual(500);
    expect(endpointer.hasSpeech).toBe(false);

    pushFor(endpointer, voiced, 500);
    endpointer.reset();
    expect(endpointer.hasSpeech).toBe(false);
    expect(endpointer.take().length).toBe(0);
  });

  it('measures the room again when the mic reopens', () => {
    const endpointer = new Endpointer();
    pushFor(endpointer, silent, 1000);
    expect(endpointer.floors.onset).toBeLessThan(0.02);

    endpointer.reset();
    pushFor(endpointer, () => chunk(0.03, 0.006), 800);
    const results = pushFor(endpointer, () => chunk(0.03, 0.006), 4000);

    expect(endpointer.floors.onset).toBeCloseTo(0.03 * 3, 1);
    expect(results).not.toContain('endpoint');
  });
});

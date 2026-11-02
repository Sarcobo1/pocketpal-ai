import {ASR_CHUNK_BYTES, ASR_SAMPLE_RATE} from '../../asr/constants';
import {
  VOICE_CLIP_MIN_RMS,
  VOICE_VAD_FLOOR_MAX_RMS,
  VOICE_VAD_FLOOR_MIN_RMS,
  VOICE_VAD_ONSET_FACTOR,
} from '../constants';
import {gateUtterance, pcmLevel, speechRunMs, vadFloors} from '../speechLevel';
import {int16PcmToFloat32} from '../../asr/energyVad';

/** `ms` of int16 PCM at a flat amplitude, little endian. */
const tone = (amplitude: number, ms: number): Uint8Array => {
  const pcm = new Uint8Array(((ASR_SAMPLE_RATE * ms) / 1000) * 2);
  const view = new DataView(pcm.buffer);
  for (let i = 0; i < pcm.length / 2; i++) {
    view.setInt16(i * 2, (i % 2 ? 1 : -1) * amplitude * 0x7fff, true);
  }
  return pcm;
};

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

describe('pcmLevel', () => {
  it('reports the RMS and the peak of a clip', () => {
    const {rms, peak} = pcmLevel(tone(0.2, 100));

    expect(rms).toBeCloseTo(0.2, 2);
    expect(peak).toBeCloseTo(0.2, 2);
  });

  it('reads an empty buffer as nothing', () => {
    expect(pcmLevel(new Uint8Array(0))).toEqual({rms: 0, peak: 0});
  });
});

describe('vadFloors', () => {
  it('scales both floors with the room tone', () => {
    const {onset, hold} = vadFloors(0.01);

    expect(onset).toBeCloseTo(0.01 * VOICE_VAD_ONSET_FACTOR, 4);
    expect(hold).toBeLessThan(onset);
  });

  it('keeps a quiet room on the floor and a loud one under the ceiling', () => {
    expect(vadFloors(0).onset).toBe(VOICE_VAD_FLOOR_MIN_RMS);
    expect(vadFloors(1).onset).toBe(VOICE_VAD_FLOOR_MAX_RMS);
  });
});

describe('speechRunMs', () => {
  it('counts the longest unbroken run, not the voiced total', () => {
    const samples = int16PcmToFloat32(
      concat(tone(0.2, 100), tone(0, 200), tone(0.2, 300)),
    );

    expect(speechRunMs(samples, 0.01)).toBe(300);
  });

  it('ignores a tail shorter than one frame', () => {
    expect(speechRunMs(int16PcmToFloat32(tone(0.2, 40)), 0.01)).toBe(30);
  });
});

describe('gateUtterance', () => {
  it('passes a clip with a run of real speech in it', () => {
    const gate = gateUtterance(concat(tone(0, 200), tone(0.1, 600)));

    expect(gate).toMatchObject({pass: true, reason: 'pass', ms: 800});
    expect(gate.speechMs).toBeGreaterThanOrEqual(600 - 30);
    expect(gate.bytes).toBe((800 / 1000) * ASR_SAMPLE_RATE * 2);
  });

  it('refuses a clip too short to be an utterance', () => {
    expect(gateUtterance(tone(0.1, 300)).reason).toBe('short');
  });

  it('refuses dead air and reports the numbers that say so', () => {
    const gate = gateUtterance(tone(0, 1000));

    expect(gate.reason).toBe('silent');
    expect(gate.rms).toBe(0);
    expect(gate.floor).toBe(VOICE_CLIP_MIN_RMS);
  });

  it('refuses energy that never runs long enough to be a word', () => {
    const taps = Array.from({length: 6}, () =>
      concat(tone(0.3, 200), tone(0, 150)),
    );
    const gate = gateUtterance(concat(...taps));

    expect(gate.reason).toBe('quiet');
    expect(gate.rms).toBeGreaterThan(VOICE_CLIP_MIN_RMS);
    expect(gate.speechMs).toBeLessThan(400);
  });

  it('measures a chunk the recorder delivers at 50 ms', () => {
    expect(gateUtterance(new Uint8Array(ASR_CHUNK_BYTES)).ms).toBe(50);
  });
});

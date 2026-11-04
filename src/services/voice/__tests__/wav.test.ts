import * as RNFS from '@dr.pogodin/react-native-fs';
import {toByteArray} from 'base64-js';

import {ASR_SAMPLE_RATE} from '../../asr/constants';
import {
  float32PcmToWav,
  int16PcmToWav,
  readWavHeader,
  writeUtteranceWav,
} from '../wav';

/** `ms` of zeroed int16 PCM, long enough to hold a whole number of frames. */
const pcmOf = (ms: number): Uint8Array =>
  new Uint8Array(((ASR_SAMPLE_RATE * ms) / 1000) * 2);

describe('int16PcmToWav', () => {
  it('wraps the recorder bytes in a header a reader can parse', () => {
    const wav = int16PcmToWav(pcmOf(100));

    expect(readWavHeader(wav)).toEqual({
      riff: true,
      format: 1, // PCM, not a float or compressed format
      channels: 1,
      sampleRate: 16000,
      bits: 16,
      dataBytes: 3200,
    });
    expect(wav.length).toBe(44 + 3200);
  });

  it('leaves the samples themselves untouched behind the header', () => {
    const pcm = pcmOf(20);
    const view = new DataView(pcm.buffer);
    for (let i = 0; i < pcm.length / 2; i++) {
      view.setInt16(i * 2, i % 2 ? -1234 : 1234, true);
    }
    const wav = int16PcmToWav(pcm);

    expect(wav.subarray(44)).toEqual(pcm);
  });

  it('says so when a buffer is not a RIFF/WAVE file', () => {
    expect(readWavHeader(new Uint8Array(44)).riff).toBe(false);
  });
});

describe('float32PcmToWav', () => {
  it('writes the decoder sample rate, not the recorder rate', () => {
    const wav = float32PcmToWav(new Float32Array(4800), 24000);

    // The speech bench dumps audio at whatever rate the voice came out at; a
    // header naming 16 kHz would play it back slow and answer the wrong question.
    expect(readWavHeader(wav)).toEqual({
      riff: true,
      format: 1,
      channels: 1,
      sampleRate: 24000,
      bits: 16,
      dataBytes: 9600,
    });
  });

  it('scales the samples and holds an overshoot instead of wrapping it', () => {
    const wav = float32PcmToWav(new Float32Array([0, 0.5, -0.5, 2]), 24000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(16383);
    expect(view.getInt16(48, true)).toBe(-16384);
    // A decoder transient above full scale is clamped: a wrapped sample clicks.
    expect(view.getInt16(50, true)).toBe(32767);
  });
});

describe('writeUtteranceWav', () => {
  it('writes the clip it is handed, as base64, and returns its path', async () => {
    const pcm = pcmOf(500);

    const path = await writeUtteranceWav(pcm);

    expect(path).toMatch(/voice-audio\/utt-\d+\.wav$/);
    const [, data, encoding] = (RNFS.writeFile as jest.Mock).mock.calls.at(-1)!;
    expect(encoding).toBe('base64');
    expect(toByteArray(data as string).subarray(44)).toEqual(pcm);
  });
});

import {fromByteArray} from 'base64-js';
import * as RNFS from '@dr.pogodin/react-native-fs';
import {Platform} from 'react-native';

import {ASR_BITS_PER_SAMPLE, ASR_CHANNELS, ASR_SAMPLE_RATE} from '../asr';
import {chatSessionStore} from '../../store';
import {logPerf} from '../../utils/mediaPerf';

import {pcmLevel} from './speechLevel';

const HEADER_BYTES = 44;

/** Voice media is kept for this many turns beyond the ones still in a chat. */
const KEEP_TURNS = 40;

/**
 * Android keeps the clips in the app's own external directory so a field
 * report can be pulled with `adb pull` and listened to; iOS stays in the
 * cache, which nothing outside the app reads anyway.
 */
const pullableDir =
  Platform.OS === 'android'
    ? RNFS.ExternalDirectoryPath || RNFS.CachesDirectoryPath
    : RNFS.CachesDirectoryPath;

export const voiceAudioDir = `${pullableDir}/voice-audio`;

const wavHeader = (dataBytes: number): Uint8Array => {
  const header = new Uint8Array(HEADER_BYTES);
  const view = new DataView(header.buffer);
  const tag = (offset: number, value: string) => {
    for (let i = 0; i < 4; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };
  const byteRate = (ASR_SAMPLE_RATE * ASR_BITS_PER_SAMPLE * ASR_CHANNELS) / 8;
  tag(0, 'RIFF');
  view.setUint32(4, HEADER_BYTES - 8 + dataBytes, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, ASR_CHANNELS, true);
  view.setUint32(24, ASR_SAMPLE_RATE, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, (ASR_BITS_PER_SAMPLE / 8) * ASR_CHANNELS, true);
  view.setUint16(34, ASR_BITS_PER_SAMPLE, true);
  tag(36, 'data');
  view.setUint32(40, dataBytes, true);
  return header;
};

/** The recorder's little-endian int16 PCM, wrapped as a RIFF/WAVE file. */
export const int16PcmToWav = (pcm: Uint8Array): Uint8Array => {
  const header = wavHeader(pcm.length);
  const wav = new Uint8Array(header.length + pcm.length);
  wav.set(header);
  wav.set(pcm, header.length);
  return wav;
};

/**
 * The header a WAV reader will actually see, taken back out of the bytes. The
 * writer and this reader agree only if the offsets and the little endianness
 * are right, so a mismatch here is the clip being wrong, not the log.
 */
export const readWavHeader = (wav: Uint8Array) => {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const tag = (offset: number) =>
    String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );
  return {
    riff:
      tag(0) === 'RIFF' &&
      tag(8) === 'WAVE' &&
      tag(12) === 'fmt ' &&
      tag(36) === 'data',
    format: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    bits: view.getUint16(34, true),
    dataBytes: view.getUint32(40, true),
  };
};

/**
 * Media that a chat still shows must stay: replaying a spoken turn sends its
 * audio again and its bubble redraws the frame. Everything older than
 * `KEEP_TURNS` files of one kind goes.
 */
export const pruneVoiceMedia = async (dir: string, extension: string) => {
  const files = (await RNFS.readDir(dir))
    .filter(file => file.name.endsWith(extension))
    .sort((a, b) => a.name.localeCompare(b.name));
  const referenced = new Set<string>();
  for (const session of chatSessionStore.sessions) {
    for (const message of session.messages) {
      if (message.type !== 'text') {
        continue;
      }
      for (const uri of [message.audioUri, ...(message.imageUris ?? [])]) {
        if (uri) {
          referenced.add(uri.replace(/^file:\/\//, ''));
        }
      }
    }
  }
  for (const file of files.slice(0, Math.max(0, files.length - KEEP_TURNS))) {
    if (!referenced.has(file.path)) {
      await RNFS.unlink(file.path).catch(() => {});
    }
  }
};

/**
 * Writes one utterance and returns the path a multimodal model reads from.
 * Every clip the model is about to hear is reported with the numbers that
 * describe it, because "the model did not hear me" and "the model heard room
 * tone" are the same failure from the chat screen and nothing else says which.
 */
export const writeUtteranceWav = async (pcm: Uint8Array): Promise<string> => {
  await RNFS.mkdir(voiceAudioDir);
  const path = `${voiceAudioDir}/utt-${Date.now()}.wav`;
  const wav = int16PcmToWav(pcm);
  await RNFS.writeFile(path, fromByteArray(wav), 'base64');
  const header = readWavHeader(wav);
  const {rms, peak} = pcmLevel(pcm);
  logPerf('utt.dump', {
    path,
    ms: Math.round((pcm.length / 2 / ASR_SAMPLE_RATE) * 1000),
    sampleRate: header.sampleRate,
    channels: header.channels,
    bits: header.bits,
    format: header.format,
    headerOk: header.riff,
    pcmBytes: pcm.length,
    dataBytes: header.dataBytes,
    wavBytes: wav.length,
    rms: Math.round(rms * 1e4) / 1e4,
    peak: Math.round(peak * 1e4) / 1e4,
  });
  await pruneVoiceMedia(voiceAudioDir, '.wav').catch(err =>
    console.warn('[voiceMode] utterance cleanup failed:', err),
  );
  return path;
};

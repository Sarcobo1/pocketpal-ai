import {fromByteArray} from 'base64-js';
import * as RNFS from '@dr.pogodin/react-native-fs';

import {ASR_BITS_PER_SAMPLE, ASR_CHANNELS, ASR_SAMPLE_RATE} from '../asr';
import {chatSessionStore} from '../../store';

const HEADER_BYTES = 44;

/** Utterance WAVs are kept for this many turns beyond the ones still in a chat. */
const KEEP_TURNS = 40;

export const voiceAudioDir = `${RNFS.CachesDirectoryPath}/voice-audio`;

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
 * WAVs that a chat still shows must stay: replaying a spoken turn sends its
 * audio again. Everything older than `KEEP_TURNS` files goes.
 */
const prune = async () => {
  const files = (await RNFS.readDir(voiceAudioDir))
    .filter(file => file.name.endsWith('.wav'))
    .sort((a, b) => a.name.localeCompare(b.name));
  const referenced = new Set<string>();
  for (const session of chatSessionStore.sessions) {
    for (const message of session.messages) {
      if (message.type === 'text' && message.audioUri) {
        referenced.add(message.audioUri);
      }
    }
  }
  for (const file of files.slice(0, Math.max(0, files.length - KEEP_TURNS))) {
    if (!referenced.has(file.path)) {
      await RNFS.unlink(file.path).catch(() => {});
    }
  }
};

/** Writes one utterance and returns the path a multimodal model reads from. */
export const writeUtteranceWav = async (pcm: Uint8Array): Promise<string> => {
  await RNFS.mkdir(voiceAudioDir);
  const path = `${voiceAudioDir}/utt-${Date.now()}.wav`;
  await RNFS.writeFile(path, fromByteArray(int16PcmToWav(pcm)), 'base64');
  await prune().catch(err =>
    console.warn('[voiceMode] utterance cleanup failed:', err),
  );
  return path;
};

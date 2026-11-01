import * as RNFS from '@dr.pogodin/react-native-fs';

import {voiceModeStore} from '../../store';
import {vtrace} from '../../utils/voiceTrace';

import {pruneVoiceMedia} from './wav';

const FRAMES_DIR = `${RNFS.CachesDirectoryPath}/voice-frames`;

/** Takes one shot as a `file://` URL, or returns null when there is none. */
export type VoiceFrameSource = () => Promise<string | null>;

let source: VoiceFrameSource | null = null;

/**
 * Called by the voice view while its camera is mounted. Voice mode runs with
 * the camera off by default, so nothing reaches the model until the user
 * turns it on, and the frame stops being taken once the view collapses.
 */
export const setVoiceFrameSource = (next: VoiceFrameSource | null): void => {
  source = next;
};

/** The frame for this turn, empty when the camera is off or the shot failed. */
export const captureVoiceFrame = async (): Promise<string[]> => {
  if (!voiceModeStore.cameraOn || !source) {
    return [];
  }
  try {
    const frame = await source();
    vtrace('camera.frame', {bytes: frame ? frame.length : 0});
    return frame ? [frame] : [];
  } catch (err) {
    console.warn('[voiceMode] camera frame failed:', err);
    return [];
  }
};

/**
 * Moves a camera shot in with the rest of the voice media, where the turn
 * count prunes it; the camera's own temp folder is nobody's to clean.
 */
export const storeVoiceFrame = async (photoPath: string): Promise<string> => {
  await RNFS.mkdir(FRAMES_DIR);
  const path = `${FRAMES_DIR}/frame-${Date.now()}.jpg`;
  await RNFS.copyFile(photoPath, path);
  await RNFS.unlink(photoPath).catch(() => {});
  await pruneVoiceMedia(FRAMES_DIR, '.jpg').catch(err =>
    console.warn('[voiceMode] frame cleanup failed:', err),
  );
  return `file://${path}`;
};

import * as RNFS from '@dr.pogodin/react-native-fs';

import {voiceModeStore} from '../../store';
import {vtrace} from '../../utils/voiceTrace';

import {logPerf, startPerf} from '../../utils/mediaPerf';
import {pruneVoiceMedia} from './wav';

const FRAMES_DIR = `${RNFS.CachesDirectoryPath}/voice-frames`;

/** Takes one shot as a `file://` URL, or returns null when there is none. */
export type VoiceFrameSource = () => Promise<string | null>;

// A vision token is one patch-grid cell, so a square frame that fills a token
// budget is `sqrt(tokens) * patch` pixels on a side. Rounded up to a 32 px step
// because camera hardware offers discrete sizes, not arbitrary ones.
const PATCH_PX = 16;
const STEP_PX = 32;

/**
 * The capture size to ask the camera for, from the projector's own per-image
 * token budget. A sensor JPEG and a 384 px JPEG cost the same vision tokens
 * once the encoder resizes them — but decoding the sensor one is far from the
 * same price, and it is the part the token budget cannot reach.
 */
export const liveFramePx = (maxTokens?: number): number => {
  const tokens = Math.min(2048, Math.max(64, maxTokens ?? 512));
  const side = Math.ceil((Math.sqrt(tokens) * PATCH_PX) / STEP_PX) * STEP_PX;
  return Math.max(192, side);
};

/**
 * The encoded size of a frame. `frame.length` is the length of the *URL*, and
 * the number that decides how long the projector spends decoding is the size of
 * the JPEG behind it.
 */
const frameBytes = async (path: string): Promise<number | undefined> => {
  try {
    const stat = await RNFS.stat(path);
    return typeof stat?.size === 'number' ? stat.size : undefined;
  } catch {
    return undefined;
  }
};

let source: VoiceFrameSource | null = null;
let inFlight = false;

/**
 * Called by the voice view while its camera is mounted. Voice mode runs with
 * the camera off by default, so nothing reaches the model until the user
 * turns it on, and the frame stops being taken once the view collapses.
 */
export const setVoiceFrameSource = (next: VoiceFrameSource | null): void => {
  source = next;
};

/**
 * The frame for this turn, empty when the camera is off or the shot failed.
 *
 * A frame is never queued behind one the model is still working on: the second
 * request of an overlap is the one that would arrive stale, so it is dropped and
 * the turn goes on with the frame it already has.
 */
export const captureVoiceFrame = async (): Promise<string[]> => {
  if (!voiceModeStore.cameraOn || !source) {
    return [];
  }
  if (inFlight) {
    logPerf('camera.frame', {dropped: true});
    return [];
  }
  inFlight = true;
  const lap = startPerf();
  try {
    const frame = await source();
    lap('camera.frame', {url: frame ? frame.length : 0});
    vtrace('camera.frame', {bytes: frame ? frame.length : 0});
    return frame ? [frame] : [];
  } catch (err) {
    lap('camera.frame', {failed: true});
    console.warn('[voiceMode] camera frame failed:', err);
    return [];
  } finally {
    inFlight = false;
  }
};

/**
 * Moves a camera shot in with the rest of the voice media, where the turn
 * count prunes it; the camera's own temp folder is nobody's to clean.
 */
export const storeVoiceFrame = async (photoPath: string): Promise<string> => {
  const bytes = await frameBytes(photoPath);
  await RNFS.mkdir(FRAMES_DIR);
  const path = `${FRAMES_DIR}/frame-${Date.now()}.jpg`;
  await RNFS.copyFile(photoPath, path);
  await RNFS.unlink(photoPath).catch(() => {});
  logPerf('frame.stored', {bytes});
  const lap = startPerf();
  await pruneVoiceMedia(FRAMES_DIR, '.jpg').catch(err =>
    console.warn('[voiceMode] frame cleanup failed:', err),
  );
  lap('frame.pruned');
  return `file://${path}`;
};

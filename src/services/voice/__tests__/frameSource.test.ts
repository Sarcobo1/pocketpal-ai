import * as RNFS from '@dr.pogodin/react-native-fs';
import {runInAction} from 'mobx';

import {voiceModeStore} from '../../../store';

import {
  captureVoiceFrame,
  liveFramePx,
  setVoiceFrameSource,
  storeVoiceFrame,
} from '../frameSource';

describe('live frame size', () => {
  it('asks the camera for the frame the token budget can actually use', () => {
    // 512 tokens at a 16 px patch is a ~362 px square; a sensor frame is many
    // times that and the encoder throws the difference away after decoding it.
    expect(liveFramePx(512)).toBe(384);
    expect(liveFramePx(256)).toBe(256);
    expect(liveFramePx(1024)).toBe(512);
  });

  it('stays inside the band a projector can serve', () => {
    expect(liveFramePx(undefined)).toBe(384);
    expect(liveFramePx(1)).toBe(192);
    expect(liveFramePx(64)).toBe(192);
    // The token budget is what bounds the frame, so a wild setting still lands
    // on the largest square that budget can fill.
    expect(liveFramePx(2048)).toBe(736);
    expect(liveFramePx(100000)).toBe(736);
  });
});

describe('voice camera frame', () => {
  afterEach(() => {
    setVoiceFrameSource(null);
    runInAction(() => {
      voiceModeStore.cameraOn = false;
    });
    jest.clearAllMocks();
  });

  it('takes nothing while the camera is off', async () => {
    const source = jest.fn(async () => 'file:///frame.jpg');
    setVoiceFrameSource(source);

    await expect(captureVoiceFrame()).resolves.toEqual([]);
    expect(source).not.toHaveBeenCalled();
  });

  it('sends the frame the source returns', async () => {
    runInAction(() => {
      voiceModeStore.cameraOn = true;
    });
    setVoiceFrameSource(async () => 'file:///frame.jpg');

    await expect(captureVoiceFrame()).resolves.toEqual(['file:///frame.jpg']);
  });

  it('drops a second request while a frame is still being taken', async () => {
    runInAction(() => {
      voiceModeStore.cameraOn = true;
    });
    let releaseShot: () => void = () => {};
    const shotTaken = new Promise<void>(resolve => {
      releaseShot = resolve;
    });
    const source = jest.fn(async () => {
      await shotTaken;
      return 'file:///frame.jpg';
    });
    setVoiceFrameSource(source);

    const first = captureVoiceFrame();
    await expect(captureVoiceFrame()).resolves.toEqual([]);
    expect(source).toHaveBeenCalledTimes(1);

    releaseShot();
    await expect(first).resolves.toEqual(['file:///frame.jpg']);

    // The guard goes with the frame, so the turn after this one is served.
    await expect(captureVoiceFrame()).resolves.toEqual(['file:///frame.jpg']);
    expect(source).toHaveBeenCalledTimes(2);
  });

  it('sends nothing when the camera has no shot to give', async () => {
    runInAction(() => {
      voiceModeStore.cameraOn = true;
    });
    setVoiceFrameSource(async () => null);

    await expect(captureVoiceFrame()).resolves.toEqual([]);
  });

  it('sends nothing when the shot fails', async () => {
    runInAction(() => {
      voiceModeStore.cameraOn = true;
    });
    setVoiceFrameSource(async () => {
      throw new Error('shutter failed');
    });

    await expect(captureVoiceFrame()).resolves.toEqual([]);
  });

  it('moves the shot in with the rest of the voice media', async () => {
    const uri = await storeVoiceFrame('/tmp/photo.jpg');

    const dest = (RNFS.copyFile as jest.Mock).mock.calls[0][1];
    expect(dest).toMatch(/^\/path\/to\/caches\/voice-frames\/frame-\d+\.jpg$/);
    expect(uri).toBe(`file://${dest}`);
    expect(RNFS.unlink).toHaveBeenCalledWith('/tmp/photo.jpg');
  });
});

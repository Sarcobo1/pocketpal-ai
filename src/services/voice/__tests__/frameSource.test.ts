import * as RNFS from '@dr.pogodin/react-native-fs';
import {runInAction} from 'mobx';

import {voiceModeStore} from '../../../store';

import {
  captureVoiceFrame,
  setVoiceFrameSource,
  storeVoiceFrame,
} from '../frameSource';

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

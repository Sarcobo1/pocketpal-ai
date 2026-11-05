import Speech from '@pocketpalai/react-native-speech';

import {SystemEngine} from '..';
import {ttsRuntime} from '../../../runtime';
import type {Voice} from '../../../types';

import {
  OS_SPEECH_HEADROOM_MS,
  OS_SPEECH_MAX_MS,
  OS_SPEECH_MS_PER_CHAR,
} from '../../../constants';

import {
  __emitError,
  __emitFinish,
  __emitStart,
  __emitStopped,
  __getCreatedStreams,
  __finishListenerCount,
  __resetCreatedStreams,
  __resetFinishListeners,
  __resetSpeechEvents,
} from '../../../../../../__mocks__/external/@pocketpalai/react-native-speech';

const VOICE: Voice = {
  id: 'com.apple.voice.Sarah',
  name: 'Sarah',
  engine: 'system',
  language: 'en-US',
};

const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setImmediate(r));
  }
};

describe('SystemEngine streaming', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetCreatedStreams();
    __resetFinishListeners();
    ttsRuntime._resetForTests();
  });

  it('playStreaming creates a lib stream with the voice id and targetChars=300', async () => {
    new SystemEngine().playStreaming(VOICE);
    await flush();

    expect(Speech.createSpeechStream).toHaveBeenCalledTimes(1);
    expect(Speech.createSpeechStream).toHaveBeenCalledWith(
      VOICE.id,
      expect.objectContaining({targetChars: 300}),
    );
  });

  it('forwards appendText to the lib stream after the engine is acquired', async () => {
    const handle = new SystemEngine().playStreaming(VOICE);

    handle.appendText('Hello world. ');
    handle.appendText('How are you?');
    await flush();

    const [stream] = __getCreatedStreams();
    expect(stream!.append).toHaveBeenCalledTimes(2);
    expect(stream!.append).toHaveBeenNthCalledWith(1, 'Hello world. ');
    expect(stream!.append).toHaveBeenNthCalledWith(2, 'How are you?');
  });

  it('appends arriving after acquire go straight to the stream', async () => {
    const handle = new SystemEngine().playStreaming(VOICE);
    await flush();

    handle.appendText('Later.');
    const [stream] = __getCreatedStreams();
    expect(stream!.append).toHaveBeenCalledWith('Later.');
  });

  it('finalize forwards to the lib stream', async () => {
    const handle = new SystemEngine().playStreaming(VOICE);

    handle.appendText('Hi.');
    await handle.finalize();

    const [stream] = __getCreatedStreams();
    expect(stream!.finalize).toHaveBeenCalledTimes(1);
  });

  it('cancel forwards to the lib stream and blocks further appends', async () => {
    const handle = new SystemEngine().playStreaming(VOICE);
    await flush();

    const [stream] = __getCreatedStreams();
    await handle.cancel();
    expect(stream!.cancel).toHaveBeenCalledTimes(1);

    handle.appendText('Too late.');
    await flush();
    expect(stream!.append).not.toHaveBeenCalled();
  });

  it('cancel before acquire completes drops pending appends', async () => {
    const handle = new SystemEngine().playStreaming(VOICE);

    handle.appendText('Buffered before engine is ready');
    await handle.cancel();
    await flush();

    // Stream was never created because cancel() fired before acquire
    const streams = __getCreatedStreams();
    expect(streams).toHaveLength(0);
  });

  it('cancel() is safe with no prior appends', async () => {
    const handle = new SystemEngine().playStreaming(VOICE);
    await expect(handle.cancel()).resolves.toBeUndefined();
  });
});

/**
 * One utterance, said by the device. `Speech.speak()` answers as soon as the
 * text is handed over, which is not the same moment the phone has finished
 * saying it — and a voice session reads the answer as "the reply is over".
 */
describe('SystemEngine plays a whole utterance', () => {
  const TEXT = 'Yes, I can hear you.';
  /** The bound for `TEXT`, as production computes it. */
  const BOUND = Math.min(
    OS_SPEECH_MAX_MS,
    TEXT.length * OS_SPEECH_MS_PER_CHAR + OS_SPEECH_HEADROOM_MS,
  );

  /** Microtasks, then `ms` of the fake clock, then the microtasks it wakes. */
  const tick = async (ms = 0) => {
    // Generous, because `play()` walks the runtime mutex, an engine load and
    // the speak dispatch before the estimate timer is even on the clock.
    for (let i = 0; i < 25; i++) {
      await Promise.resolve();
    }
    jest.advanceTimersByTime(ms);
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
    }
  };

  const played = () => {
    let settled = false;
    const promise = new SystemEngine().play(TEXT, VOICE).then(() => {
      settled = true;
    });
    return {settled: () => settled, promise};
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    __resetSpeechEvents();
    __resetCreatedStreams();
    ttsRuntime._resetForTests();
    (Speech.speak as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('waits for the device to say it, not to take it', async () => {
    const {settled, promise} = played();
    await tick(100);

    expect(Speech.speak).toHaveBeenCalledWith(TEXT, VOICE.id);
    expect(settled()).toBe(false);

    __emitFinish();
    await promise;
    expect(settled()).toBe(true);
  });

  it('is ended by the barge-in that cuts it short', async () => {
    const {settled, promise} = played();
    await tick(100);
    expect(settled()).toBe(false);

    __emitStopped();
    await promise;
    expect(settled()).toBe(true);
  });

  it('is ended by a device that refuses the sentence', async () => {
    const {settled, promise} = played();
    await tick(100);

    __emitError();
    await promise;
    expect(settled()).toBe(true);
  });

  it('takes the voice announcing itself as the utterance beginning', async () => {
    // A device whose dispatch never answers: the start event is the only thing
    // that can make the events after it ours.
    (Speech.speak as jest.Mock).mockReturnValue(new Promise(() => {}));
    const {settled, promise} = played();
    await tick(100);

    __emitFinish();
    expect(settled()).toBe(false);

    __emitStart();
    __emitFinish();
    await promise;
    expect(settled()).toBe(true);
  });

  it('ignores the event still travelling from the sentence before it', async () => {
    // The listeners are on and nothing has reached the OS yet: an event in this
    // window belongs to the utterance the reply began by stopping.
    (Speech.speak as jest.Mock).mockReturnValue(new Promise(() => {}));
    const {settled, promise} = played();
    await tick(100);

    __emitFinish();
    __emitStopped();
    expect(settled()).toBe(false);

    await tick(BOUND);
    await promise;
    expect(settled()).toBe(true);
  });

  it('gives a device that reports nothing the length of the sentence', async () => {
    const {settled, promise} = played();
    await tick(BOUND - 100);
    expect(settled()).toBe(false);

    await tick(200);
    await promise;
    expect(settled()).toBe(true);
  });

  it('lets a dispatch that never happened go, rather than hold the ear', async () => {
    (Speech.speak as jest.Mock).mockRejectedValueOnce(
      new Error('no voice data'),
    );
    const {settled, promise} = played();

    await promise;
    expect(settled()).toBe(true);
  });

  it('stops listening to the device once the utterance is done', async () => {
    const {promise} = played();
    await tick(100);
    __emitFinish();
    await promise;

    expect(__finishListenerCount()).toBe(0);
  });
});

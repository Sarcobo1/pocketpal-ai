/**
 * Jest mock for `@pocketpalai/react-native-speech`.
 *
 * The real package ships untranspiled source + TurboModule bindings, neither
 * of which Jest can load. We expose the subset PocketPal uses, including
 * `createSpeechStream` (v2.1.0+) which returns a handle with
 * `append/finalize/cancel`. Each stream is a jest-tracked object so tests
 * can assert on the calls forwarded into it.
 */

type FinishListener = (event: {utteranceId?: string}) => void;
const finishListeners = new Set<FinishListener>();

type StartListener = (event: {utteranceId?: string}) => void;
const startListeners = new Set<StartListener>();

const onStart = jest.fn((listener: StartListener) => {
  startListeners.add(listener);
  return {
    remove: jest.fn(() => {
      startListeners.delete(listener);
    }),
  };
});

/** Test helper: emit an `onStart` event to all registered listeners. */
export const __emitStart = (utteranceId?: string) => {
  for (const l of Array.from(startListeners)) {
    l({utteranceId});
  }
};

/** Test helper: number of currently-registered onStart listeners. */
export const __startListenerCount = () => startListeners.size;

/** Test helper: clear onStart listeners between tests. */
export const __resetStartListeners = () => {
  startListeners.clear();
};

const onFinish = jest.fn((listener: FinishListener) => {
  finishListeners.add(listener);
  return {
    remove: jest.fn(() => {
      finishListeners.delete(listener);
    }),
  };
});

/**
 * Test helper: emit an `onFinish` event to all registered listeners.
 * Exported so tests can drive the streaming chain without a real native
 * module.
 */
export const __emitFinish = (utteranceId?: string) => {
  for (const l of Array.from(finishListeners)) {
    l({utteranceId});
  }
};

/** Test helper: number of currently-registered onFinish listeners. */
export const __finishListenerCount = () => finishListeners.size;

/** Test helper: clear listeners between tests. */
export const __resetFinishListeners = () => {
  finishListeners.clear();
};

type StopListener = (event: {utteranceId?: string}) => void;
const stopListeners = new Set<StopListener>();

const onStopped = jest.fn((listener: StopListener) => {
  stopListeners.add(listener);
  return {
    remove: jest.fn(() => {
      stopListeners.delete(listener);
    }),
  };
});

/** Test helper: emit an `onStopped` event, the one a barge-in answers with. */
export const __emitStopped = (utteranceId?: string) => {
  for (const l of Array.from(stopListeners)) {
    l({utteranceId});
  }
};

type ErrorListener = (event: {utteranceId?: string}) => void;
const errorListeners = new Set<ErrorListener>();

const onError = jest.fn((listener: ErrorListener) => {
  errorListeners.add(listener);
  return {
    remove: jest.fn(() => {
      errorListeners.delete(listener);
    }),
  };
});

/** Test helper: emit an `onError` event, the one a refused utterance answers with. */
export const __emitError = (utteranceId?: string) => {
  for (const l of Array.from(errorListeners)) {
    l({utteranceId});
  }
};

/** Test helper: clear the stop/error listeners between tests. */
export const __resetSpeechEvents = () => {
  startListeners.clear();
  finishListeners.clear();
  stopListeners.clear();
  errorListeners.clear();
};

export interface MockSpeechStream {
  voiceId?: string;
  options?: Record<string, unknown>;
  append: jest.Mock;
  finalize: jest.Mock;
  cancel: jest.Mock;
  onProgress: jest.Mock;
}

const createdStreams: MockSpeechStream[] = [];

const createSpeechStream = jest.fn(
  (voiceId?: string, options?: Record<string, unknown>): MockSpeechStream => {
    const stream: MockSpeechStream = {
      voiceId,
      options,
      append: jest.fn(),
      finalize: jest.fn().mockResolvedValue(undefined),
      cancel: jest.fn().mockResolvedValue(undefined),
      onProgress: jest.fn(() => jest.fn()),
    };
    createdStreams.push(stream);
    return stream;
  },
);

/** Test helper: list of streams created since the last reset. */
export const __getCreatedStreams = (): MockSpeechStream[] => createdStreams;

/** Test helper: clear stream history between tests. */
export const __resetCreatedStreams = () => {
  createdStreams.length = 0;
};

const Speech = {
  initialize: jest.fn().mockResolvedValue(undefined),
  speak: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  release: jest.fn().mockResolvedValue(undefined),
  getAvailableVoices: jest.fn().mockResolvedValue([
    {
      identifier: 'com.apple.voice.Sarah',
      name: 'Sarah',
      language: 'en-US',
      quality: 0,
    },
  ]),
  createSpeechStream,
  onStart,
  onFinish,
  onStopped,
  onError,
  registerEngine: jest.fn(),
  getEngineSupport: jest
    .fn()
    .mockResolvedValue({supported: false, reason: 'not-compiled'}),
};

export default Speech;

export const onAudioInterruption = jest.fn(() => ({remove: jest.fn()}));

/** Mirror of the fork's `TTSEngine` enum — minimum surface used by tests. */
export enum TTSEngine {
  OS_NATIVE = 'os-native',
  KOKORO = 'kokoro',
  SUPERTONIC = 'supertonic',
  POCKET = 'pocket',
  KITTEN = 'kitten',
}

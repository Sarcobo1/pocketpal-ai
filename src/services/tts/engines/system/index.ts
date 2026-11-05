import Speech, {TTSEngine} from '@pocketpalai/react-native-speech';

import {
  OS_SPEECH_HEADROOM_MS,
  OS_SPEECH_MAX_MS,
  OS_SPEECH_MS_PER_CHAR,
} from '../../constants';
import {ttsRuntime} from '../../runtime';
import {createEngineStreamingHandle} from '../../streamingHandle';
import type {Engine, StreamingHandle, Voice} from '../../types';
import {getSystemVoices} from './voices';

/**
 * Say `text` with the OS voice and answer only once it has been said.
 *
 * `Speech.speak()` resolves on dispatch: the phone is still talking when the
 * promise is. A voice session waits on that promise as the last sound of its
 * reply, so answering on the dispatch opens the microphone under the sentence
 * the model just said — which is both the reply nobody heard finish and the
 * echo that comes back as the next question. The device itself says when an
 * utterance starts, stops and fails, and those are what this waits for; the
 * character estimate behind them is only for a device that says nothing.
 */
const speakUntilHeard = (text: string, voiceId: string): Promise<void> =>
  new Promise<void>(resolve => {
    let heard = false;
    /** True once this utterance is the one the OS is working through. */
    let open = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (heard) {
        return;
      }
      heard = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      subs.forEach(sub => sub.remove());
      resolve();
    };
    /** An event about this utterance, not one still travelling from the last. */
    const heardEvent = () => {
      if (open) {
        finish();
      }
    };
    const subs = [
      Speech.onStart(() => {
        open = true;
      }),
      Speech.onFinish(heardEvent),
      Speech.onStopped(heardEvent),
      Speech.onError(heardEvent),
    ];
    timer = setTimeout(
      finish,
      Math.min(
        OS_SPEECH_MAX_MS,
        text.length * OS_SPEECH_MS_PER_CHAR + OS_SPEECH_HEADROOM_MS,
      ),
    );
    Speech.speak(text, voiceId)
      .then(() => {
        open = true;
      })
      .catch(finish);
  });

/**
 * Thin wrapper around the OS native TTS path exposed by
 * `@pocketpalai/react-native-speech`. Always available on iOS 13+ / Android 8+.
 */
export class SystemEngine implements Engine {
  readonly id = 'system' as const;

  async isInstalled(): Promise<boolean> {
    return true;
  }

  getVoices(): Promise<Voice[]> {
    return getSystemVoices();
  }

  /**
   * The fork still requires `Speech.initialize({engine: OS_NATIVE})` when
   * switching from a neural engine — needed so playback routes through the
   * OS native path instead of staying on the previously-active neural
   * engine. The runtime calls this whenever System becomes the active
   * engine; switching back to a neural engine triggers its own loadInto.
   */
  async loadInto(): Promise<void> {
    await Speech.initialize({engine: TTSEngine.OS_NATIVE});
  }

  async play(text: string, voice: Voice): Promise<void> {
    await ttsRuntime.acquire(this, () => speakUntilHeard(text, voice.id));
  }

  /**
   * Streaming path. The library's stream degrades to roughly per-sentence
   * speaks on OS engine (native `speak()` resolves on dispatch, so the
   * stream's underrun guard fires immediately), but the OS native queue
   * handles the chaining — behavior is equivalent to the prior JS-side
   * `onFinish` loop and we inherit the library's CJK sentence handling.
   */
  playStreaming(voice: Voice, waitFor?: Promise<void>): StreamingHandle {
    return createEngineStreamingHandle(this, voice.id, undefined, waitFor);
  }

  async stop(): Promise<void> {
    await Speech.stop();
  }
}

import {modelStore, ttsStore} from '../../store';
import {ModelOrigin} from '../../utils/types';

/**
 * LFM3-Omni carries its speech decoder in the same projector file it already
 * loads to hear the microphone, so a reply does not have to go through a TTS
 * engine at all. Whether the running context can voice a reply is a property
 * of the model, not of the user's voice choice, so this is the one place that
 * asks for it.
 */

let probe: {contextId: number; audioGen: boolean} | null = null;

/**
 * True when the active context can generate speech. Only a `yes` is cached:
 * attaching a projector to a context that is already running can turn a `no`
 * into a `yes`, and a model that can speak never stops being able to.
 */
export const modelCanVoiceReplies = async (): Promise<boolean> => {
  if (ttsStore.forceTTSFallback) {
    return false;
  }
  if (modelStore.activeModel?.origin === ModelOrigin.REMOTE) {
    return false;
  }
  const ctx = modelStore.context;
  if (!ctx) {
    return false;
  }
  if (probe?.contextId === ctx.id && probe.audioGen) {
    return true;
  }
  let audioGen: boolean;
  try {
    audioGen = (await ctx.getMultimodalSupport()).audioGen === true;
  } catch (err) {
    console.warn('[voice] speech support probe failed:', err);
    return false;
  }
  probe = {contextId: ctx.id, audioGen};
  return audioGen;
};

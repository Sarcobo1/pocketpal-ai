import React, {useRef} from 'react';
import {AccessibilityInfo} from 'react-native';

import {toJS} from 'mobx';
import type {JinjaFormattedChatResult} from 'llama.rn';

import {randId} from '../utils';
import {L10nContext} from '../utils';
import {
  chatSessionStore,
  modelStore,
  NEW_SESSION_TITLE,
  palStore,
  serverStore,
  ttsStore,
  uiStore,
} from '../store';
import type {GenerationLease} from '../store/generationLease';
import type {PersistedTurnTimings} from '../utils/completionTypes';
import {
  clampEffort,
  resolveReasoningCapability,
} from '../utils/reasoningCapability';

import {
  MessageType,
  ModelOrigin,
  User,
  type AgentToolCall,
  type MediaSupport,
} from '../utils/types';
import {
  RemoteModelNotReadyError,
  RemoteModelRequestWithdrawnError,
  createMultimodalWarning,
} from '../utils/errors';
import {routerFailureMessage} from '../utils/routerCopy';
import {
  assembleMessages,
  resolveSystemMessages,
} from '../utils/systemPromptResolver';
import {
  convertToChatMessages,
  countMediaParts,
  removeThinkingParts,
  visibleStepContent,
} from '../utils/chat';
import {acquireKeepAwake} from '../utils/keepAwake';
import {vtrace} from '../utils/voiceTrace';
import {logPerf} from '../utils/mediaPerf';
import {toLocalMediaPath} from '../utils/multimodalPatterns';
import {LLAMARN_ERROR_PATTERNS} from '../utils/llamaRnErrors';
import {projectionGapCopy} from '../utils/multimodalHelpers';
import {
  toApiCompletionParams,
  ApiCompletionParams,
  CompletionParams,
  CompletionResult,
  CompletionResultSnapshot,
} from '../utils/completionTypes';
import {
  collectSystemPromptFragments,
  seedReadUrlAllowlist,
  talentRegistry,
} from '../services/talents';
import type {ToolDefinition} from '../services/talents/types';
import {
  agentStateReducer,
  createTriggerMarkerCache,
  DEFAULT_MAX_TURNS,
  initialAgentUiState,
  runAgent,
  type AgentEvent,
  type AgentUiState,
  type TokenDelta,
} from '../services/agent';
// Helper function to prepare completion parameters using OpenAI-compatible
// messages API. Creates the empty `assistant_turn` row up-front so the
// active-vs-persisted predicate sees the right "last message" before the
// run flips to `preparing`.
const prepareCompletion = async ({
  imageUris,
  audioUri,
  message,
  systemMessages,
  contextId,
  assistant,
  conversationIdRef,
  l10n,
  currentMessages,
  spoken,
}: {
  imageUris: string[];
  audioUri?: string;
  message: MessageType.PartialText;
  systemMessages: Array<{role: 'system'; content: string}>;
  contextId: string;
  assistant: User;
  conversationIdRef: string;
  l10n: any;
  currentMessages: MessageType.Any[];
  spoken: boolean;
}) => {
  const sessionCompletionSettings =
    await chatSessionStore.getCurrentCompletionSettings();
  const stopWords = toJS(modelStore.activeModel?.stopWords);

  // Check if we have media and if multimodal is enabled
  const hasImages = imageUris && imageUris.length > 0;
  const hasAudio = !!audioUri;

  // A projector attaches to a context that is already running, so a turn that
  // carries media asks for one before being downgraded to plain text. Without
  // this a model imported from storage — whose pairing lands only when
  // ModelStore next reads its folder — sends a camera frame as a caption.
  // A remote binding has no projector at all: its answer is the probe the
  // capability view already holds.
  const remoteActive = modelStore.activeModel?.origin === ModelOrigin.REMOTE;
  let media: MediaSupport = remoteActive
    ? {
        vision: modelStore.activeModelCaps.visionActive,
        audioInput: false,
        audioOutput: false,
      }
    : modelStore.activeMediaSupport;
  if (
    !remoteActive &&
    (hasImages || hasAudio) &&
    !media.vision &&
    !media.audioInput
  ) {
    await modelStore.ensureMultimodalActive();
    media = modelStore.activeMediaSupport;
  }
  // Each modality is decided on its own: an omni projector that hears need not
  // see, and offering the camera to it produces a caption about nothing.
  const canImages = !!hasImages && media.vision;
  const canAudio = hasAudio && media.audioInput;
  const multimodalReady = canImages || canAudio;

  // Create user message content - use array format only for multimodal,
  // string for text-only.
  let userMessageContent: any;

  if (multimodalReady) {
    userMessageContent = [
      {
        type: 'text',
        text: message.text,
      },
      ...(canImages
        ? imageUris.map(path => ({
            // The raw URI: llama.rn strips file:// off an image url itself, and
            // a remote server expects the URL it was always given.
            type: 'image_url',
            image_url: {url: path},
          }))
        : []),
    ];
    if (canAudio) {
      // `url`, not `data`: llama.rn strips file:// from the former and pushes
      // the latter verbatim, so a content URI in `data` never opens.
      userMessageContent.push({
        type: 'input_audio',
        input_audio: {url: toLocalMediaPath(audioUri), format: 'wav'},
      });
    }
  } else {
    userMessageContent = message.text;

    if (hasImages || hasAudio) {
      // The generic copy is the wrong answer when the app knows exactly which
      // file is missing, which is the usual reason a camera turn lands here.
      uiStore.setChatWarning(
        createMultimodalWarning(
          projectionGapCopy(modelStore.projectionGap, l10n) ??
            l10n.chat.multimodalNotEnabled,
        ),
      );
    }
  }

  // Half a turn is worse than none: an attached audio-only projector takes the
  // mic and drops the camera frame that came with it.
  if (
    multimodalReady &&
    ((hasImages && !canImages) || (hasAudio && !canAudio))
  ) {
    uiStore.setChatWarning(
      createMultimodalWarning(l10n.chat.multimodalNotEnabled),
    );
  }

  // Convert chat session messages to llama.rn format. Filtering
  // image-typed messages happens here (multimodal user messages carry
  // their images via imageUris on the Text row, not a separate Image
  // message). AssistantTurn rows pass through to convertToChatMessages,
  // which expands each step into assistant + tool API messages.
  //
  // A spoken turn reads its own frame and nothing else. The projector encodes
  // every media part it is handed on every completion, so carrying the earlier
  // shots of a live session makes turn N pay for N frames; the words of the
  // conversation stay whole either way.
  //
  // Audio is never replayed, spoken turn or not: the model has already heard
  // it, and a clip from three turns ago answers whatever is asked now. A row
  // left with neither text nor media would drop out of the history entirely,
  // which is worse than a placeholder — the model would find its own last
  // reply answering a question nobody asked, and fall back to introducing
  // itself.
  const stripHistoryMedia = (msg: MessageType.Any): MessageType.Any => {
    if (msg.type !== 'text') {
      return msg;
    }
    const dropAudio = !!msg.audioUri;
    const dropImages = spoken && !!msg.imageUris?.length;
    if (!dropAudio && !dropImages) {
      return msg;
    }
    const next: MessageType.Text = {
      ...msg,
      ...(dropAudio ? {audioUri: undefined} : {}),
      ...(dropImages ? {imageUris: undefined} : {}),
    };
    if (!next.text?.trim()) {
      next.text = dropAudio ? '[voice message]' : '[image]';
    }
    return next;
  };

  const historyMessages = currentMessages.map(stripHistoryMedia);

  let chatMessages = convertToChatMessages(
    historyMessages.filter(msg => msg.type !== 'image'),
    multimodalReady,
  );

  // Strip thinking parts from assistant context if the user opted out.
  const includeThinkingInContext =
    (sessionCompletionSettings as CompletionParams)
      ?.include_thinking_in_context !== false;
  if (!includeThinkingInContext) {
    chatMessages = chatMessages.map(msg => {
      if (msg.role === 'assistant' && typeof msg.content === 'string') {
        return {
          ...msg,
          content: removeThinkingParts(msg.content),
        };
      }
      return msg;
    });
  }

  // Talent-contributed system-prompt fragments (e.g. search grounding). Kept on
  // the initial messages array so they persist across every follow-up tool turn.
  const sessionToolNames = (
    (sessionCompletionSettings?.tools as ToolDefinition[] | undefined) ?? []
  ).map(tool => tool.function?.name ?? '');
  const systemPromptFragments = collectSystemPromptFragments(sessionToolNames, {
    now: new Date(),
    maxToolTurns: DEFAULT_MAX_TURNS,
  });

  const messages = assembleMessages(systemMessages, systemPromptFragments, [
    ...chatMessages,
    {role: 'user', content: userMessageContent},
  ]);

  // Reseed the read_url exfiltration allowlist for this run; the trust policy
  // (which sources count) lives in the talents module.
  seedReadUrlAllowlist(messages, currentMessages);

  const completionParamsWithAppProps = {
    ...sessionCompletionSettings,
    // A spoken reply must start talking at once, not after a reasoning pass.
    ...(spoken ? {enable_thinking: false, reasoning: {enabled: false}} : {}),
    messages,
    stop: stopWords,
  };

  const cleanCompletionParams = toApiCompletionParams(
    completionParamsWithAppProps as CompletionParams,
  );

  // Every media part in the finished prompt, not just this turn's: a projector
  // re-encodes what it is handed on each completion.
  const promptMedia =
    hasImages || hasAudio
      ? countMediaParts(cleanCompletionParams.messages)
      : undefined;

  // Settles the question every media turn raises: did the frame reach the
  // prompt, or was it dropped because no projector could take it?
  if (hasImages || hasAudio) {
    console.log(
      '[chat] media turn',
      JSON.stringify({
        projector: {vision: media.vision, audioInput: media.audioInput},
        parts: Array.isArray(userMessageContent)
          ? userMessageContent.map(part => part.type)
          : ['text'],
        dropped: [
          ...(hasImages && !canImages ? ['image'] : []),
          ...(hasAudio && !canAudio ? ['audio'] : []),
        ],
        inPrompt: promptMedia,
        messageCount: cleanCompletionParams.messages?.length ?? 0,
      }),
    );
  }

  // reasoning_format is always 'auto' for the local (llama.rn) path: a no-op for
  // non-reasoning models and the value that extracts reasoning into
  // reasoning_content instead of leaking raw channel/think markers into content
  // (e.g. gemma-4 emits an empty <|channel>thought block even when thinking is
  // off). On/off is carried solely by enable_thinking. "Off" stays a best-effort
  // hint — it never strips reasoning the model still returns (rendered by
  // ReasoningBlock); separate from include_thinking_in_context, which only
  // governs what prior <think> we SEND.
  const reasoningCapability = resolveReasoningCapability(
    modelStore.activeModel,
    serverStore.remoteReasoning,
  );
  cleanCompletionParams.reasoning_format = 'auto';
  // Thinking off. It used to be sent only to reasoning-capable models, on the
  // assumption that a model without reasoning ignores it — but llama.rn defaults
  // enable_thinking to true, and a template that branches on it (LFM3-Omni ends
  // the generation prompt with an unclosed <think> unless told off) hands that
  // model a state it cannot finish. Set at the top level too, because llama.rn
  // reads params.enable_thinking before it merges chat_template_kwargs.
  if (!cleanCompletionParams.enable_thinking) {
    cleanCompletionParams.enable_thinking = false;
    cleanCompletionParams.chat_template_kwargs = {
      ...cleanCompletionParams.chat_template_kwargs,
      enable_thinking: false,
    };
  }
  // Graded effort (gpt-oss-style): carried by the resolver-populated intent.
  // The stored effort may be another model's; clamp it on the intent, which
  // the remote engines read too.
  if (cleanCompletionParams.reasoning) {
    cleanCompletionParams.reasoning = {
      ...cleanCompletionParams.reasoning,
      effort: clampEffort(
        cleanCompletionParams.reasoning.effort,
        reasoningCapability.effortValues,
      ),
    };
  }
  const reasoningEffort = cleanCompletionParams.reasoning?.effort;
  if (reasoningEffort) {
    cleanCompletionParams.chat_template_kwargs = {
      ...cleanCompletionParams.chat_template_kwargs,
      reasoning_effort: reasoningEffort,
    };
  }

  // Create the empty AssistantTurn row in the store BEFORE the run
  // flips agentUiState.status to `preparing` so the active-vs-persisted
  // predicate (last message AND status in active set) sees a coherent
  // state from the very first frame.
  const createdAt = Date.now();
  const emptyTurn: MessageType.AssistantTurn = {
    author: assistant,
    createdAt,
    id: '', // populated by addMessageToCurrentSession
    type: 'assistant_turn',
    steps: [],
    metadata: {
      contextId,
      conversationId: conversationIdRef,
      // copyable is intentionally absent here: the turn footer's copy
      // button renders iff metadata.copyable is set, and at this point
      // the turn has nothing worth copying yet. It is set later at
      // run_finished (success/maxTurns) or at the abort catch path with
      // partial content.
      multimodal: hasImages,
      ...(spoken ? {spoken: true} : {}),
    },
  };

  await chatSessionStore.addMessageToCurrentSession(emptyTurn);

  const messageInfo = {
    createdAt,
    id: emptyTurn.id, // set by addMessageToCurrentSession
    sessionId: chatSessionStore.activeSessionId!,
  };

  return {cleanCompletionParams, messageInfo, promptMedia};
};

// Per-run TTS streaming state. The runner emits content/reasoning
// CUMULATIVE PER STEP on each `token` event (mirroring llama.rn's
// callback semantics); the TTS streaming hooks expect per-call deltas,
// so we diff cumulative against `prev*` (reset at each step) and
// forward only the new substring.
// Carried in ctx so a single run keeps a coherent audio stream.
type TtsRunState = {
  // Snapshot of ttsStore.streamsReplies at run start; gates the per-chunk
  // TTS hook. Per-run so mid-stream toggles don't flicker audio.
  enabled: boolean;
  started: boolean;
  mayEcho: boolean;
  prevContent: string;
  prevReasoning: string;
  stepMode: 'undecided' | 'streaming' | 'held';
  spokeAny: boolean;
};

const TTS_STEP_SEPARATOR = '\n\n';

function decideTtsStepMode(
  content: string,
  mayEcho: boolean,
): TtsRunState['stepMode'] {
  const firstChar = content.trimStart()[0];
  if (!firstChar) {
    return 'undecided';
  }
  return mayEcho && (firstChar === '{' || firstChar === '`')
    ? 'held'
    : 'streaming';
}

function spokenChunk(
  tts: TtsRunState,
  text: string,
  isStepStart: boolean,
): string {
  const chunk = isStepStart && tts.spokeAny ? TTS_STEP_SEPARATOR + text : text;
  tts.spokeAny = true;
  return chunk;
}

// Echo-shaped steps are held until step_finished, where the tool calls
// that decide visibility land; every other step streams per token.
function forwardTokenToTts(
  messageId: string,
  delta: TokenDelta,
  tts: TtsRunState,
): void {
  const cumulativeContent = delta.content ?? tts.prevContent;
  const cumulativeReasoning = delta.reasoningContent ?? tts.prevReasoning;
  if (!tts.started && (delta.content || delta.reasoningContent)) {
    tts.started = true;
    ttsStore.onAssistantMessageStart(messageId);
  }
  if (tts.stepMode === 'undecided') {
    tts.stepMode = decideTtsStepMode(cumulativeContent, tts.mayEcho);
  }
  if (tts.stepMode === 'held') {
    tts.prevContent = cumulativeContent;
  }
  const contentDelta =
    tts.stepMode === 'streaming' &&
    cumulativeContent.length > tts.prevContent.length
      ? cumulativeContent.slice(tts.prevContent.length)
      : '';
  const reasoningDelta =
    cumulativeReasoning.length > tts.prevReasoning.length
      ? cumulativeReasoning.slice(tts.prevReasoning.length)
      : '';
  if (!contentDelta && !reasoningDelta) {
    return;
  }
  const contentChunk = contentDelta
    ? spokenChunk(tts, contentDelta, tts.prevContent === '')
    : '';
  if (tts.stepMode === 'streaming') {
    tts.prevContent = cumulativeContent;
  }
  tts.prevReasoning = cumulativeReasoning;
  ttsStore.onAssistantMessageChunk(
    messageId,
    contentChunk,
    reasoningDelta || undefined,
  );
}

function releaseHeldStepToTts(
  messageId: string,
  toolCalls: AgentToolCall[] | undefined,
  tts: TtsRunState,
): void {
  const visible = visibleStepContent({content: tts.prevContent, toolCalls});
  if (visible) {
    ttsStore.onAssistantMessageChunk(
      messageId,
      spokenChunk(tts, visible, true),
      undefined,
    );
  }
}

// Normalise a finished turn's result into the snapshot the banner reads.
// `contextFull` is frozen here as the OR of the native full/truncated flags
// and (remote only) a 'length' finish reason derived from `stopped_limit`.
function deriveSnapshotFromResult(
  result: CompletionResult,
  isRemote: boolean,
): CompletionResultSnapshot {
  // Without a prompt term the total is a predicted-only tally, which is not an
  // occupancy number on either path.
  const used =
    result.tokens_evaluated === undefined
      ? undefined
      : result.tokens_evaluated + (result.tokens_predicted ?? 0);
  // Local turns set context_full/truncated directly; finishReason only bridges
  // the remote engine's signal (stopped_limit) into the OR predicate below, so
  // it is intentionally remote-only.
  const finishReason =
    isRemote && result.stopped_limit === 1 ? 'length' : undefined;
  const contextFull =
    result.context_full === true ||
    result.truncated === true ||
    finishReason === 'length';
  return {
    content: result.content,
    reasoning_content: result.reasoning_content,
    used,
    contextFull,
    tokensPredicted: result.tokens_predicted,
    finishReason,
    isRemote,
  };
}

/**
 * Map a single AgentEvent into the corresponding store mutation(s).
 * Free of business logic — every event maps to a known action surface
 * on `chatSessionStore`. This is the only place inside the run
 * lifecycle that writes to the store. The reducer
 * (`agentStateReducer`) updates `agentUiState` separately.
 */
async function applyEventToStore(
  event: AgentEvent,
  ctx: {
    messageId: string;
    sessionId: string;
    completionStartTime: number;
    timeToFirstTokenMs: {value: number | null};
    hasImages: boolean;
    isMultimodalEnabled: boolean;
    promptMedia: {images: number; audio: number} | undefined;
    tts: TtsRunState;
    stopped: boolean;
  },
): Promise<void> {
  switch (event.type) {
    case 'run_started':
      // Status flip happens in the reducer; the empty AssistantTurn
      // already exists (created in prepareCompletion). Nothing else to
      // persist here — the message was added before the run started.
      return;
    case 'step_started':
      if (ctx.tts.enabled) {
        ctx.tts.prevContent = '';
        ctx.tts.prevReasoning = '';
        ctx.tts.stepMode = 'undecided';
      }
      await chatSessionStore.pushAgentStep(ctx.messageId, ctx.sessionId, {
        partial: true,
      });
      return;
    case 'token': {
      const hasFirstTokenSignal = !!(
        event.delta.content || event.delta.reasoningContent
      );
      if (ctx.timeToFirstTokenMs.value === null && hasFirstTokenSignal) {
        ctx.timeToFirstTokenMs.value = Date.now() - ctx.completionStartTime;
      }
      if (!modelStore.isStreaming) {
        modelStore.setIsStreaming(true);
      }
      // Learn-from-stream: the first time a model emits reasoning while the
      // resolver does not already know it reasons, persist the learned flag so
      // the pill becomes reachable on the next render. The store writer is
      // idempotent and never downgrades a user/learned 'yes'.
      if (
        event.delta.reasoningContent &&
        event.delta.reasoningContent.length > 0
      ) {
        const activeModel = modelStore.activeModel;
        if (
          activeModel &&
          resolveReasoningCapability(activeModel, serverStore.remoteReasoning)
            .isReasoning !== 'yes'
        ) {
          modelStore.recordReasoningObserved(activeModel.id);
        }
      }
      // Wrapped so a TTS failure cannot kill the completion stream.
      if (ctx.tts.enabled) {
        try {
          forwardTokenToTts(ctx.messageId, event.delta, ctx.tts);
        } catch (ttsErr) {
          console.warn('[useChatSession] TTS stream hook failed:', ttsErr);
        }
      }
      // Per-token writes go through the throttled streaming path so
      // they coalesce. Only forward fields that were actually present in
      // this delta to avoid clobbering existing content with empty.
      // toolCalls are not written here — the reducer still consumes
      // `event.delta.toolCalls` for pendingTalentNames, but the
      // canonical step.toolCalls write happens after step_finished via
      // appendToolCall so ids match outcomes by construction.
      const partial: Partial<MessageType.AssistantTurn['steps'][number]> = {};
      if (event.delta.content) {
        partial.content = event.delta.content.replace(/^\s+/, '');
      }
      if (event.delta.reasoningContent) {
        partial.reasoningContent = event.delta.reasoningContent;
      }
      if (Object.keys(partial).length > 0) {
        chatSessionStore.updateActiveStepStreaming(
          ctx.messageId,
          ctx.sessionId,
          partial,
        );
      }
      return;
    }
    case 'marker_seen':
      // Reducer handles status flip; no per-step persistence needed.
      return;
    case 'tool_call_started':
      // Reducer handles status flip; the call payload is already on
      // the active step from the preceding `token` event with toolCalls.
      return;
    case 'tool_call_finished':
      await chatSessionStore.appendToolOutcome(
        ctx.messageId,
        ctx.sessionId,
        event.outcome,
      );
      return;
    case 'step_finished':
      if (ctx.tts.enabled && ctx.tts.stepMode === 'held') {
        try {
          releaseHeldStepToTts(ctx.messageId, event.toolCalls, ctx.tts);
        } catch (ttsErr) {
          console.warn('[useChatSession] TTS stream hook failed:', ttsErr);
        }
      }
      // Land step.toolCalls AFTER step_finished with the runner's
      // authoritative normalized ids so they match outcomes' callIds by
      // construction. Skipped for text-only and final-of-chain steps
      // (no payload attached).
      if (event.toolCalls && event.toolCalls.length > 0) {
        await chatSessionStore.appendToolCall(
          ctx.messageId,
          ctx.sessionId,
          event.toolCalls,
        );
      }
      await chatSessionStore.finalizeActiveStep(ctx.messageId, ctx.sessionId);
      return;
    case 'run_finished': {
      // Final timings + observability for hit-max-turns. Kept here
      // (not in the runner) because timings are an observability
      // concern of the hook, not the runner.
      const finalResult = event.result.finalResult;
      vtrace('run.done', {
        stopped: ctx.stopped,
        tokens: finalResult.tokens_predicted,
        chars: finalResult.content?.length,
        eos: finalResult.stopped_eos,
        limit: finalResult.stopped_limit,
        word: finalResult.stopped_word,
        interrupted: finalResult.interrupted,
      });
      const snapshot = deriveSnapshotFromResult(
        finalResult,
        modelStore.activeModel?.origin === ModelOrigin.REMOTE,
      );
      const draftTimings =
        finalResult.draft_tokens != null && finalResult.draft_tokens > 0
          ? {
              draft_tokens: finalResult.draft_tokens,
              draft_tokens_accepted: finalResult.draft_tokens_accepted,
            }
          : {};
      const timings: PersistedTurnTimings = {
        ...(finalResult.timings ?? {}),
        time_to_first_token_ms: ctx.timeToFirstTokenMs.value,
        ...draftTimings,
      };
      // The one number a media turn is really judged by: how long the prompt
      // took, next to how much media the prompt carried. Prefill grows with the
      // frames the projector is handed, not with the words.
      if (ctx.promptMedia) {
        logPerf('turn.eval', {
          images: ctx.promptMedia.images,
          audio: ctx.promptMedia.audio,
          promptN: timings.prompt_n,
          promptMs: timings.prompt_ms,
          ppTokSec: timings.prompt_per_second,
          cached: timings.cache_n,
          genMs: timings.predicted_ms,
          tokens: timings.predicted_n,
          tokSec: timings.predicted_per_second,
          ttft: timings.time_to_first_token_ms,
          projector: modelStore.multimodalDevice,
          nCtx: modelStore.activeContextSettings?.n_ctx,
        });
      }
      await chatSessionStore.updateMessage(ctx.messageId, ctx.sessionId, {
        metadata: {
          timings,
          copyable: true,
          multimodal: ctx.hasImages && ctx.isMultimodalEnabled,
          completionResult: snapshot,
          ...(event.result.hitMaxTurns ? {hitMaxTurns: true} : {}),
        },
      });
      chatSessionStore.recordCompletionSnapshot(snapshot);
      if (snapshot.isRemote) {
        modelStore.reprobeRemoteCapsAfterCompletion();
      }
      if (event.result.hitMaxTurns) {
        console.warn(
          '[useChatSession] agent run hit maxTurns; surfacing last available content',
        );
      }
      // Fire TTS auto-speak after the final text is observable. Store
      // enforces auto-speak / voice / idempotency gating internally.
      // A stopped run ends on whatever step it reached, often a tool-call
      // step, so it speaks nothing more; a stop that bypassed
      // handleStopPress (model switch, video Pal) still left its stream open.
      // Wrapped defensively — UI-path errors must not bubble.
      if (ctx.stopped) {
        const playback = ttsStore.playbackState;
        if (
          playback.mode === 'streaming' &&
          playback.messageId === ctx.messageId
        ) {
          ttsStore.stop('run_stopped').catch(ttsErr => {
            console.warn('[useChatSession] TTS stop on abort failed:', ttsErr);
          });
        }
        return;
      }
      try {
        ttsStore.onAssistantMessageComplete(
          ctx.messageId,
          finalResult.text ?? '',
          {hadReasoning: !!finalResult.reasoning_content?.trim()},
        );
      } catch (ttsErr) {
        console.warn('[useChatSession] TTS complete hook failed:', ttsErr);
      }
      return;
    }
    case 'run_failed':
      // Failure handled by the surrounding try/catch in the hook.
      return;
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

/**
 * Lets queued touches dispatch. Ends at once when `signal` aborts: JS timers
 * do not fire while the app is backgrounded, and a release there waits for
 * this run to drain.
 */
function yieldToTouches(signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, 0);
    signal.addEventListener('abort', done);
  });
}

export type UndoneSend = {
  message: MessageType.PartialText;
  sessionId: string;
};

export type SendOptions = {
  /** The message was spoken in voice mode: both rows are marked, and the
   * reply runs with thinking off. */
  spoken?: boolean;
  /** Receives the assistant turn's id as soon as its row exists. */
  onTurnCreated?: (turnId: string) => void;
};

export const useChatSession = (
  currentMessageInfo: React.MutableRefObject<{
    createdAt: number;
    id: string;
    sessionId: string;
  } | null>,
  user: User,
  assistant: User,
) => {
  const l10n = React.useContext(L10nContext);
  const conversationIdRef = useRef<string>(randId());
  // Trigger-marker cache lifetime is scoped to the hook (useRef). No
  // module-level mutable state — see triggerMarkers.ts contract.
  // Resolved before each runAgent call; the resulting string[] is
  // passed into AgentRunOptions.triggerMarkers so the runner has no
  // direct dependency on the cache, modelStore, or getFormattedChat.
  const triggerCacheRef = useRef(createTriggerMarkerCache());
  const leaseRef = useRef<GenerationLease | null>(null);
  const stopsBeforeLease = useRef(0);

  const addMessage = async (message: MessageType.Any) => {
    await chatSessionStore.addMessageToCurrentSession(message);
  };

  const systemRow = (text: string, metadata = {}): MessageType.Text => ({
    author: assistant,
    createdAt: Date.now(),
    id: randId(),
    text,
    type: 'text',
    metadata: {system: true, ...metadata},
  });

  const addSystemMessage = async (text: string, metadata = {}) => {
    await addMessage(systemRow(text, metadata));
  };

  const handleSendPress = async (
    message: MessageType.PartialText,
    opts: SendOptions = {},
  ): Promise<UndoneSend | undefined> => {
    const sentFrom = chatSessionStore.activeSessionId;
    const stopsAtSend = stopsBeforeLease.current;
    if (modelStore.isGenerationBusy) {
      chatSessionStore.setIsStopping(true);
    }
    const lease = await modelStore.acquireGeneration();
    chatSessionStore.setIsStopping(false);
    if (chatSessionStore.activeSessionId !== sentFrom) {
      lease?.end();
      chatSessionStore.restoreUnsentText(sentFrom, message.text);
      return;
    }
    if (!lease) {
      await addSystemMessage(l10n.chat.modelNotLoaded);
      return;
    }
    leaseRef.current = lease;
    const stopsWhileWaiting = stopsBeforeLease.current - stopsAtSend;
    vtrace('lease.grant', {spoken: !!opts.spoken, stopsWhileWaiting});
    if (stopsWhileWaiting !== 0) {
      lease.abort();
    }

    // Run UI clears on abort, not on drain.
    let uiStopped = false;
    let releaseAwake: (() => void) | undefined;
    const uiStop = () => {
      if (uiStopped) {
        return;
      }
      uiStopped = true;
      modelStore.setInferencing(false);
      modelStore.setIsStreaming(false);
      chatSessionStore.setIsGenerating(false);
      chatSessionStore.setAgentUiState(initialAgentUiState);
      chatSessionStore.setToolCallTokenCount(0);
      releaseAwake?.();
    };
    if (lease.signal.aborted) {
      uiStop();
    } else {
      lease.signal.addEventListener('abort', uiStop);
    }

    try {
      return await sendUnderLease(message, lease, opts, {
        stop: uiStop,
        isStopped: () => uiStopped,
        holdAwake: () => {
          if (!uiStopped) {
            releaseAwake ??= acquireKeepAwake();
          }
        },
      });
    } finally {
      lease.signal.removeEventListener('abort', uiStop);
      uiStop();
      if (leaseRef.current === lease) {
        leaseRef.current = null;
      }
      lease.end();
    }
  };

  const sendUnderLease = async (
    message: MessageType.PartialText,
    lease: GenerationLease,
    opts: SendOptions,
    runUi: {
      stop: () => void;
      isStopped: () => boolean;
      holdAwake: () => void;
    },
  ): Promise<UndoneSend | undefined> => {
    const engine = lease.engine;
    const contextId = modelStore.contextId;
    if (!contextId) {
      await addSystemMessage(l10n.chat.modelNotLoaded);
      return;
    }

    const imageUris = message.imageUris;
    const hasImages = !!(imageUris && imageUris.length > 0);
    const audioUri = message.audioUri;
    const hasAudio = !!audioUri;

    const currentMessages = toJS(chatSessionStore.currentSessionMessages);

    const textMessage: MessageType.Text = {
      author: user,
      createdAt: Date.now(),
      id: '',
      text: message.text,
      type: 'text',
      imageUris: hasImages ? imageUris : undefined,
      audioUri: hasAudio ? audioUri : undefined,
      metadata: {
        contextId,
        conversationId: conversationIdRef.current,
        copyable: true,
        multimodal: hasImages || hasAudio,
        ...(opts.spoken ? {spoken: true} : {}),
      },
    };
    const wasUntitled =
      (chatSessionStore.sessions.find(
        s => s.id === chatSessionStore.activeSessionId,
      )?.title ?? NEW_SESSION_TITLE) === NEW_SESSION_TITLE;
    await addMessage(textMessage);
    if (!lease.signal.aborted) {
      modelStore.setInferencing(true);
      modelStore.setIsStreaming(false);
      chatSessionStore.setIsGenerating(true);
      runUi.holdAwake();
    }

    const activeSession = chatSessionStore.sessions.find(
      s => s.id === chatSessionStore.activeSessionId,
    );
    const pal = activeSession?.activePalId
      ? palStore.pals.find(p => p.id === activeSession.activePalId)
      : null;

    const systemMessages = resolveSystemMessages({
      pal,
      model: modelStore.activeModel,
    });

    const {cleanCompletionParams, messageInfo, promptMedia} =
      await prepareCompletion({
        imageUris: imageUris || [],
        audioUri,
        message,
        systemMessages,
        contextId,
        assistant,
        conversationIdRef: conversationIdRef.current,
        l10n,
        currentMessages,
        spoken: !!opts.spoken,
      });

    currentMessageInfo.current = messageInfo;
    opts.onTurnCreated?.(messageInfo.id);

    // Allowed talent names for this Pal. The runner rejects any
    // tool call whose function.name isn't in this list.
    const palTalents = (pal?.pact?.talents ?? []).map(t => t.name);

    const completionStartTime = Date.now();
    const timeToFirstTokenMs: {value: number | null} = {value: null};
    let uiState: AgentUiState = initialAgentUiState;

    // Precompute trigger markers via the per-hook cache. We use the
    // CLOSURE form of `getFormattedChat` (NOT `.bind(...)`) because the
    // method is multi-arg and requires `params: {tools, jinja: true}`
    // to populate `grammar_triggers`. A bare bind would call the
    // method with no arguments and silently return empty markers,
    // defeating marker detection. Failure is non-fatal: we fall back
    // to `[]` and let `tool_call_started` drive the UX flip (one beat
    // later) instead of `marker_seen`.
    const tools =
      (cleanCompletionParams.tools as ToolDefinition[] | undefined) ?? [];
    const tts: TtsRunState = {
      enabled: ttsStore.streamsReplies,
      started: false,
      mayEcho: tools.length > 0,
      prevContent: '',
      prevReasoning: '',
      stepMode: 'undecided',
      spokeAny: false,
    };
    let triggerMarkers: string[] = [];
    // Marker detection reads `grammar_triggers` from a local Jinja
    // `getFormattedChat` call — only meaningful when a local llama.rn
    // context exists. In server mode (`modelStore.context` undefined)
    // the remote llama.cpp parser handles tool-call detection on its
    // own, so this whole step is skipped. Without the guard the
    // non-null assertion below throws TypeError on every server-mode
    // turn (caught + warned, but noisy).
    const localContext = modelStore.context;
    if (localContext) {
      try {
        triggerMarkers = await triggerCacheRef.current.getMarkers(
          String(localContext.id),
          tools,
          () =>
            localContext.getFormattedChat(
              cleanCompletionParams.messages ?? [],
              undefined,
              {tools: cleanCompletionParams.tools, jinja: true},
            ) as Promise<JinjaFormattedChatResult>,
        );
      } catch (e) {
        console.warn('[chat] trigger marker compute failed; falling back', e);
      }
    }

    let undone: UndoneSend | undefined;
    try {
      const events = runAgent({
        engine,
        initialParams: cleanCompletionParams as ApiCompletionParams,
        allowedTalentNames: palTalents,
        talentLookup: name => talentRegistry.get(name),
        triggerMarkers,
        messageId: messageInfo.id,
        signal: lease.signal,
      });

      // The chunk-cycle would otherwise run entirely via microtask
      // resumption from queue.next(), starving the macrotask queue
      // where touch events ride — Stop taps could sit for tens of
      // seconds during long streams. A setTimeout(_, 0) yield every
      // YIELD_INTERVAL_MS lets touches dispatch. The yield also
      // decouples native production from consumption, so a backlog
      // can grow on fast models; the abort guard below drops queued
      // token events on stop while lifecycle events still run.
      let lastYieldTs = performance.now();
      const YIELD_INTERVAL_MS = 100;

      // Bucket the tool-token counter: PendingIndicator hides counts
      // below 10, so publish every increment up to 10, then only on
      // bucket boundaries. Drops the indicator's re-render rate by
      // ~10× without visible loss.
      let toolCallTokensRaw = 0;
      const TOOL_TOKEN_BUCKET = 10;

      for await (const event of events) {
        if (lease.signal.aborted && event.type === 'token') {
          continue;
        }

        // Reference guard before MobX write: deep observables wrap
        // values in a proxy, so equality inside the setter can't see
        // "same object". The reducer returns the input ref when nothing
        // changed; without this guard every event still publishes.
        const nextUiState = agentStateReducer(uiState, event);
        if (nextUiState !== uiState) {
          uiState = nextUiState;
          if (!runUi.isStopped()) {
            chatSessionStore.setAgentUiState(nextUiState);
          }
        }

        switch (event.type) {
          case 'run_started':
          case 'step_started':
          case 'tool_call_started':
          case 'run_finished':
          case 'run_failed':
            toolCallTokensRaw = 0;
            if (!runUi.isStopped()) {
              chatSessionStore.setToolCallTokenCount(0);
            }
            break;
          case 'token':
            if (event.delta.toolCalls && event.delta.toolCalls.length > 0) {
              toolCallTokensRaw += 1;
              if (
                toolCallTokensRaw < TOOL_TOKEN_BUCKET ||
                toolCallTokensRaw % TOOL_TOKEN_BUCKET === 0
              ) {
                chatSessionStore.setToolCallTokenCount(toolCallTokensRaw);
              }
            }
            break;
          default:
            break;
        }

        await applyEventToStore(event, {
          messageId: messageInfo.id,
          sessionId: messageInfo.sessionId,
          completionStartTime,
          timeToFirstTokenMs,
          hasImages,
          // Read as the turn runs: the projector that answers this is attached
          // inside prepareCompletion, so a value captured before it would be
          // the one from a session that could not see. The capability view
          // covers both kinds of session — an attached projector locally, the
          // probed binding remotely.
          isMultimodalEnabled: modelStore.activeModelCaps.visionActive,
          promptMedia,
          tts,
          stopped: lease.signal.aborted,
        });

        if (performance.now() - lastYieldTs >= YIELD_INTERVAL_MS) {
          await yieldToTouches(lease.signal);
          lastYieldTs = performance.now();
        }

        if (event.type === 'run_failed') {
          throw event.error;
        }
      }
    } catch (error) {
      console.error('Completion error:', error);
      vtrace('run.error', {aborted: lease.signal.aborted});
      // Send stays blocked until an undone turn's rows are gone.
      if (!(error instanceof RemoteModelRequestWithdrawnError)) {
        runUi.stop();
      }

      // Stop any in-flight TTS — the completion errored, so buffered
      // audio should not keep playing.
      ttsStore.stop('run_error').catch(ttsErr => {
        console.warn('[useChatSession] TTS stop on error failed:', ttsErr);
      });

      const errorMessage = (error as Error).message;
      // Native tool-call parser throws on truncated JSON when the model
      // ran out of context mid-args (most often `render_html` with a
      // long string). Detect by error shape and route through the
      // turn's metadata so the footer can show a friendlier hint
      // instead of a multi-KB raw error dump.
      const isToolArgsParseError =
        LLAMARN_ERROR_PATTERNS.toolArgsParse.test(errorMessage);
      // Prompt-processing overflow: when the prompt itself exceeds n_ctx
      // (ctx_shift is off — the llama.rn default), the native layer throws
      // "Context is full" before any token is generated, so it never reaches
      // run_finished. Treat it as an n_ctx-exhaustion signal so the banner
      // surfaces instead of a raw error dump.
      const isContextFullError =
        LLAMARN_ERROR_PATTERNS.contextFull.test(errorMessage);
      const treatAsContextFull = isToolArgsParseError || isContextFullError;
      // Low-RAM devices can fail to allocate the speculative draft context at
      // first completion (the load-time memory check has no term for it).
      const isSpeculativeInitError =
        LLAMARN_ERROR_PATTERNS.speculativeInit.test(errorMessage);

      // Error rollback path. The empty/in-flight AssistantTurn row
      // already exists; preserve any partial steps and tag with
      // {interrupted, copyable} (plus {truncationLikely} on the
      // tool-call parse case). The store widening from step 2 ensures
      // this metadata write does not silently no-op on assistant_turn
      // rows and does not clobber metadata.steps.
      let turnAbsorbedError = false;
      const session = chatSessionStore.sessions.find(
        s => s.id === messageInfo.sessionId,
      );
      const currentMsg = session?.messages.find(
        msg => msg.id === messageInfo.id,
      );

      const hasAnyStepContent =
        currentMsg?.type === 'assistant_turn' &&
        ((currentMsg as MessageType.AssistantTurn).steps ?? []).some(
          s => (s.content?.length ?? 0) > 0 || (s.toolCalls?.length ?? 0) > 0,
        );
      const hasLegacyText =
        currentMsg?.type === 'text' && !!(currentMsg as MessageType.Text).text;
      const hasPartialContent = hasAnyStepContent || hasLegacyText;

      if (hasPartialContent) {
        // No finalResult on the abort path, so no turn reported a count.
        // truncationLikely is the n_ctx-exhaustion signal: when set, treat
        // the turn as full and pin `used` to the context window so the
        // sticky banner's freshness gate holds. Otherwise the count is
        // unknown, which is not zero.
        const isRemote = modelStore.activeModel?.origin === ModelOrigin.REMOTE;
        const effectiveNCtx = modelStore.activeModelCaps.effectiveContextLength;
        const abortSnapshot: CompletionResultSnapshot = {
          used: treatAsContextFull ? effectiveNCtx : undefined,
          contextFull: treatAsContextFull,
          isRemote,
        };
        await chatSessionStore.updateMessage(
          messageInfo.id,
          messageInfo.sessionId,
          {
            metadata: {
              interrupted: true,
              copyable: true,
              completionResult: abortSnapshot,
              ...(isToolArgsParseError ? {truncationLikely: true} : {}),
            },
          },
        );
        chatSessionStore.recordCompletionSnapshot(abortSnapshot);
        // The turn now carries the failure context; suppress the
        // duplicate `Completion failed: …` system message dump.
        turnAbsorbedError = true;
      } else {
        // A prompt that overflows n_ctx throws before any token, so there
        // is no content to keep — but still record the snapshot so the
        // banner surfaces the full state. The empty turn is cleaned up
        // below; the store snapshot drives the banner independently.
        // Per-process for this draft: with no message persisted, the banner
        // does not rehydrate after a session switch / restart (it re-fires
        // on the next overflowing send).
        if (isContextFullError) {
          const isRemote =
            modelStore.activeModel?.origin === ModelOrigin.REMOTE;
          const effectiveNCtx =
            modelStore.activeModelCaps.effectiveContextLength;
          chatSessionStore.recordCompletionSnapshot({
            used: effectiveNCtx,
            contextFull: true,
            isRemote,
          });
          turnAbsorbedError = true;
        }
        await chatSessionStore.deleteMessageFromSession(
          messageInfo.sessionId,
          messageInfo.id,
        );
      }

      if (turnAbsorbedError) {
        // Footer already surfaces interrupted / truncationLikely; nothing
        // more to add to chat.
      } else if (error instanceof RemoteModelRequestWithdrawnError) {
        if (!hasPartialContent) {
          await chatSessionStore.deleteMessageFromSession(
            messageInfo.sessionId,
            textMessage.id,
          );
          if (wasUntitled) {
            await chatSessionStore.updateSessionTitleBySessionId(
              messageInfo.sessionId,
              NEW_SESSION_TITLE,
            );
          }
          undone = {message, sessionId: messageInfo.sessionId};
        }
      } else if (error instanceof RemoteModelNotReadyError) {
        const text = routerFailureMessage(
          error.cause,
          error.serverMessage,
          l10n,
        );
        await chatSessionStore.addMessageToSession(
          messageInfo.sessionId,
          systemRow(text),
        );
        AccessibilityInfo.announceForAccessibility(text);
      } else if (errorMessage.includes('network')) {
        await addSystemMessage(l10n.common.networkError);
      } else if (isToolArgsParseError) {
        // No turn content to attach the hint to — fall back to a
        // friendly system message instead of the raw native error dump.
        await addSystemMessage(l10n.chat.toolCallTruncated);
      } else if (isSpeculativeInitError) {
        await addSystemMessage(l10n.chat.speculativeInitFailed);
      } else if (isContextFullError) {
        // No turn to attach to; surface the banner via a store snapshot
        // rather than dumping the raw "Context is full" native error.
        chatSessionStore.recordCompletionSnapshot({
          used: modelStore.activeModelCaps.effectiveContextLength,
          contextFull: true,
          isRemote: modelStore.activeModel?.origin === ModelOrigin.REMOTE,
        });
      } else {
        await addSystemMessage(`${l10n.chat.completionFailed}${errorMessage}`);
      }
    }
    return undone;
  };

  const handleResetConversation = async () => {
    conversationIdRef.current = randId();
    await addSystemMessage(l10n.chat.conversationReset);
  };

  const handleStopPress = async () => {
    vtrace('stopPress', {
      lease: !!leaseRef.current,
      stopsBeforeLease: stopsBeforeLease.current,
    });
    if (leaseRef.current) {
      leaseRef.current.abort();
    } else {
      stopsBeforeLease.current += 1;
    }
    // Stop any in-flight TTS so buffered audio doesn't keep playing
    // after the user tapped Stop.
    ttsStore.stop('stop_press').catch(err => {
      console.warn('[useChatSession] TTS stop on user-stop failed:', err);
    });
  };

  return {
    handleSendPress,
    handleResetConversation,
    handleStopPress,
  };
};

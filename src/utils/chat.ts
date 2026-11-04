import {applyTemplate, Templates} from 'chat-formatter';
import {JinjaFormattedChatResult, LlamaContext} from 'llama.rn';
import {CompletionParams} from './completionTypes';
import {defaultCompletionParams} from './completionSettingsVersions';
import {toLocalMediaPath} from './multimodalPatterns';
import {stripControlTokens} from './omniMode';

import {
  AgentStep,
  AgentToolCall,
  ChatMessage,
  ChatTemplateConfig,
  HuggingFaceModel,
  MessageType,
  Model,
} from './types';

export const userId = 'y9d7f8pgn';
export const assistantId = 'h3o3lc5xj';
export const user = {id: userId};
export const assistant = {id: assistantId};

/**
 * Returns the visible textual content of a message in a single string.
 * Used by every `.text`-style consumer that should observe "final
 * visible content" — Bubble copy, drawer preview, exports, session
 * titles — so the type bifurcation between `Text` and `AssistantTurn`
 * is contained to one helper.
 *
 * For `AssistantTurn`, joins each step's `visibleStepContent` with a blank
 * line (matching the visible block-per-step rendering). Steps with no
 * visible content (e.g. tool-call-only steps) are skipped.
 */
/** A message as it stands at the end of the API layer, read only for media. */
type PromptMessage = {content?: string | Array<{type?: string}> | null};

/**
 * Media parts carried by a finished prompt, across every message in it. One
 * frame costs the projector the same whether the user attached it now or three
 * turns ago, so a turn that looks like a text turn can still be re-encoding a
 * gallery — this is the count that explains a slow prefill.
 */
export function countMediaParts(messages?: PromptMessage[]): {
  images: number;
  audio: number;
} {
  let images = 0;
  let audio = 0;
  for (const message of messages ?? []) {
    const parts = Array.isArray(message.content) ? message.content : undefined;
    for (const part of parts ?? []) {
      if (part.type === 'image_url') {
        images += 1;
      } else if (part.type === 'input_audio') {
        audio += 1;
      }
    }
  }
  return {images, audio};
}

export function derivedText(message: MessageType.Any): string {
  if (message.type === 'assistant_turn') {
    return ((message as MessageType.AssistantTurn).steps ?? [])
      .map(visibleStepContent)
      .filter(c => c.length > 0)
      .join('\n\n');
  }
  const raw = 'text' in message && message.text ? message.text : '';
  // A plain-text assistant row stored before the leak was closed still shows
  // what it stored. A user's own words are never rewritten.
  return message.author.id === assistant.id ? stripControlTokens(raw) : raw;
}

const FENCED_BLOCK = /^```[^\n`]*\n([\s\S]*)```$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => jsonEqual(item, b[i]))
    );
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every(key => key in b && jsonEqual(a[key], b[key]))
    );
  }
  return a === b;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function parseToolCallObject(
  text: string,
): {name: string; arguments: Record<string, unknown>} | undefined {
  const fenced = FENCED_BLOCK.exec(text);
  const parsed = parseJson(fenced ? fenced[1].trim() : text);
  if (
    isPlainObject(parsed) &&
    Object.keys(parsed).length === 2 &&
    typeof parsed.name === 'string' &&
    isPlainObject(parsed.arguments)
  ) {
    return {name: parsed.name, arguments: parsed.arguments};
  }
  return undefined;
}

function callArguments(call: AgentToolCall): unknown {
  const args: unknown = call.function?.arguments;
  return typeof args === 'string' ? parseJson(args) : args;
}

/**
 * A step's text as shown to the user. Small models may write a call as
 * bare JSON before emitting it in tags; that echo is hidden here only,
 * because replay must send the stored content unchanged.
 *
 * A leaked control token is hidden at the same place and for the same reason:
 * `<|text_end|>` is not an answer, and rows written before the sampler was
 * guarded still hold the ones they were given.
 */
export function visibleStepContent(step: AgentStep): string {
  const content = stripControlTokens(step.content ?? '');
  if (!step.toolCalls || step.toolCalls.length === 0) {
    return content;
  }
  const trimmed = content.trim();
  if (trimmed[0] !== '{' && trimmed[0] !== '`') {
    return content;
  }
  const echo = parseToolCallObject(trimmed);
  if (!echo) {
    return content;
  }
  const isEcho = step.toolCalls.some(
    call =>
      call.function?.name === echo.name &&
      jsonEqual(callArguments(call), echo.arguments),
  );
  return isEcho ? '' : content;
}

/**
 * Serialize an in-memory `AgentToolCall` into the wire shape llama.rn /
 * OpenAI accept. `function.arguments` is stored as a JSON-encoded
 * string throughout the runner; this just lifts it onto a ChatMessage.
 */
function toWireToolCall(
  call: AgentToolCall,
): NonNullable<ChatMessage['tool_calls']>[number] {
  return {
    id: call.id,
    type: 'function',
    function: {
      name: call.function?.name ?? '',
      arguments: call.function?.arguments ?? '',
    },
  } as NonNullable<ChatMessage['tool_calls']>[number];
}

/**
 * Build the API messages for one `AgentStep`. Emits an assistant message
 * (with `tool_calls` if present) followed by one role:'tool' message per
 * outcome. The OpenAI spec requires assistant-with-tool_calls to PRECEDE
 * its tool responses so `tool_call_id` back-refs resolve — preserved
 * by the inner ordering here (OUTER reverse below does not reorder inner
 * arrays).
 *
 * Orphan-pair guard: a step persisted with `tool_calls` but no matching
 * `tool_outcomes` (user abort fired between `step_finished` and
 * `tool_call_finished`, or process crash mid-step) would otherwise emit
 * `assistant.tool_calls` with zero matching `role:'tool'` responses.
 * Strict-Jinja chat templates reject that ("every tool_call_id must
 * have a matching tool response") and the next turn's prompt becomes
 * malformed. Synthesize an "aborted" sentinel response for every
 * unmatched call so the invariant holds on reload.
 */
function stepToApiMessages(step: AgentStep): ChatMessage[] {
  const assistantMsg: ChatMessage = {
    role: 'assistant',
    // Replay of a turn that leaked its mode tokens teaches the model that
    // leaking them is the expected shape of an answer, so the old rows are
    // cleaned on the way in rather than only on the way out.
    content: stripControlTokens(step.content ?? ''),
  };
  if (step.toolCalls && step.toolCalls.length > 0) {
    assistantMsg.tool_calls = step.toolCalls.map(toWireToolCall);
  }
  if (step.reasoningContent) {
    assistantMsg.reasoning_content = step.reasoningContent;
  }
  const outcomes = step.toolOutcomes ?? [];
  const outcomeIds = new Set(outcomes.map(o => o.callId));
  const toolMsgs: ChatMessage[] = outcomes.map(o => ({
    role: 'tool',
    tool_call_id: o.callId,
    content: o.responseContent,
  }));
  // Orphan-pair guard (see fn doc): for any toolCall that lacks a
  // matching outcome, synthesize a sentinel response. Order matches the
  // toolCalls order so the assistant_msg.tool_calls[i] ↔ toolMsgs[i]
  // back-ref resolution stays stable for any consumer that relies on it.
  if (step.toolCalls) {
    for (const call of step.toolCalls) {
      if (!outcomeIds.has(call.id)) {
        toolMsgs.push({
          role: 'tool',
          tool_call_id: call.id,
          content: 'aborted',
        });
      }
    }
  }
  return [assistantMsg, ...toolMsgs];
}

export function convertToChatMessages(
  messages: MessageType.Any[],
  isMultimodalEnabled: boolean = true,
): ChatMessage[] {
  const groups: ChatMessage[][] = messages
    .filter(message => {
      if (message.type === 'assistant_turn') {
        // Include any AssistantTurn whose steps array is non-empty.
        // Filter rule preserves turns where a step has only tool_calls
        // (empty content) — the model still needs to see those plus
        // their tool responses on the next iteration so tool_call_id
        // back-refs resolve.
        return ((message as MessageType.AssistantTurn).steps ?? []).length > 0;
      }
      if (message.type === 'text') {
        const text = (message as MessageType.Text).text;
        return text !== undefined && text !== null && text.trim() !== '';
      }
      return false;
    })
    .map(message => {
      if (message.type === 'assistant_turn') {
        const turn = message as MessageType.AssistantTurn;
        // Each step → assistant message (+ tool messages). All steps for
        // one turn are emitted as one inner group so the OUTER reverse
        // keeps them adjacent in chronological order.
        return (turn.steps ?? []).flatMap(stepToApiMessages);
      }

      const textMessage = message as MessageType.Text;
      const role: 'assistant' | 'user' =
        message.author.id === assistant.id ? 'assistant' : 'user';
      // Same reason as the step replay above: an assistant row written before
      // the sampler was guarded carries the tokens it leaked, and the next
      // prompt would read them back as this model's own style.
      const messageText =
        role === 'assistant'
          ? stripControlTokens(textMessage.text || '')
          : textMessage.text || '';

      // Multimodal user messages keep their existing shape.
      if (
        ((textMessage.imageUris && textMessage.imageUris.length > 0) ||
          textMessage.audioUri) &&
        isMultimodalEnabled
      ) {
        const contentArray: Array<{
          type: 'text' | 'image_url' | 'input_audio';
          text?: string;
          image_url?: {url: string};
          input_audio?: {url?: string; data?: string; format: string};
        }> = [
          {
            type: 'text',
            text: messageText,
          },
        ];

        contentArray.push(
          ...(textMessage.imageUris ?? []).map(path => ({
            type: 'image_url' as const,
            image_url: {url: path},
          })),
        );

        // llama.rn reads media from local paths, not from URLs, and one
        // projector file carries both the vision and the audio encoder for
        // omni models, so `isMultimodalEnabled` covers audio on purpose.
        if (textMessage.audioUri) {
          contentArray.push({
            type: 'input_audio' as const,
            input_audio: {
              url: toLocalMediaPath(textMessage.audioUri),
              format: 'wav',
            },
          });
        }

        return [
          {
            role,
            content: contentArray,
          } as ChatMessage,
        ];
      }

      return [
        {
          role,
          content: messageText,
        } as ChatMessage,
      ];
    });
  return groups.reverse().flat();
}

/**
 * Formats chat messages using the appropriate template based on the model or context.
 *
 * @param messages - Array of OAI compatible chat messages
 * @param model - The model configuration, which may contain a custom chat template
 * @param context - The LlamaContext instance, which may contain a chat template
 * @returns A formatted prompt
 *
 * Priority of template selection:
 * 1. Model's custom chat template (if available)
 * 2. Context's model-specific template (if available)
 * 3. Default chat template as fallback
 */
export async function applyChatTemplate(
  messages: ChatMessage[],
  model: Model | null,
  context: LlamaContext | null,
): Promise<string | JinjaFormattedChatResult> {
  const modelChatTemplate = model?.chatTemplate;
  const contextChatTemplate = (context?.model as any)?.metadata?.[
    'tokenizer.chat_template'
  ];

  let formattedChat: string | JinjaFormattedChatResult | undefined;

  try {
    // Model's custom chat template. This uses chat-formatter, which is based on Nunjucks (as opposed to Jinja2).
    if (modelChatTemplate?.chatTemplate) {
      // Convert multimodal messages to text-only for chat-formatter compatibility
      const textOnlyMessages = messages.map(msg => ({
        ...msg,
        content: Array.isArray(msg.content)
          ? msg.content.find(part => part.type === 'text')?.text || ''
          : msg.content,
      }));
      formattedChat = applyTemplate(textOnlyMessages, {
        customTemplate: modelChatTemplate,
        addGenerationPrompt: modelChatTemplate.addGenerationPrompt,
      }) as string;
    } else if (contextChatTemplate) {
      // Context's model-specific chat template. This uses llama.cpp's getFormattedChat.
      formattedChat = await context?.getFormattedChat(messages);
    }

    if (!formattedChat) {
      // Default chat template - convert multimodal messages to text-only for chat-formatter compatibility
      const textOnlyMessages = messages.map(msg => ({
        ...msg,
        content: Array.isArray(msg.content)
          ? msg.content.find(part => part.type === 'text')?.text || ''
          : msg.content,
      }));
      formattedChat = applyTemplate(textOnlyMessages, {
        customTemplate: chatTemplates.default,
        addGenerationPrompt: chatTemplates.default.addGenerationPrompt,
      }) as string;
    }
  } catch (error) {
    console.error('Error applying chat template:', error); // TODO: handle error
  }

  return formattedChat || ' ';
}

export const chatTemplates: Record<string, ChatTemplateConfig> = {
  custom: {
    name: 'custom',
    addGenerationPrompt: true,
    bosToken: '',
    eosToken: '',
    chatTemplate: '',
    systemPrompt: '',
  },
  danube3: {
    ...Templates.templates.danube2,
    name: 'danube3',
    addGenerationPrompt: true,
    systemPrompt:
      'You are a helpful assistant named H2O Danube3. You are precise, concise, and casual.',
  },
  danube2: {
    ...Templates.templates.danube2,
    name: 'danube2',
    addGenerationPrompt: true,
    systemPrompt:
      'You are a helpful assistant named H2O Danube2. You are precise, concise, and casual.',
  },
  phi3: {
    ...Templates.templates.phi3,
    name: 'phi3',
    addGenerationPrompt: true,
    systemPrompt:
      'You are a helpful conversational chat assistant. You are precise, concise, and casual.',
  },
  gemmaIt: {
    ...Templates.templates.gemmaIt,
    name: 'gemmaIt',
    addGenerationPrompt: true,
    systemPrompt:
      'You are a helpful conversational chat assistant. You are precise, concise, and casual.',
  },
  chatML: {
    ...Templates.templates.chatML,
    name: 'chatML',
    addGenerationPrompt: true,
    systemPrompt:
      'You are a helpful conversational chat assistant. You are precise, concise, and casual.',
  },
  default: {
    ...Templates.templates.default,
    name: 'default',
    addGenerationPrompt: true,
    systemPrompt:
      'You are a helpful conversational chat assistant. You are precise, concise, and casual.',
  },
  llama3: {
    ...Templates.templates.llama3,
    name: 'llama3',
    addGenerationPrompt: true,
    systemPrompt:
      'You are a helpful conversational chat assistant. You are precise, concise, and casual.',
  },
  llama32: {
    ...Templates.templates.llama32,
    name: 'llama32',
    addGenerationPrompt: true,
    systemPrompt: '',
  },
  gemmasutra: {
    ...Templates.templates.gemmasutra,
    name: 'gemmasutra',
    addGenerationPrompt: true,
    systemPrompt:
      'You are a helpful conversational chat assistant. You are precise, concise, and casual.',
  },
  qwen2: {
    ...Templates.templates.qwen2,
    name: 'qwen2',
    addGenerationPrompt: true,
    systemPrompt: 'You are a helpful assistant.',
  },
  qwen25: {
    ...Templates.templates.qwen25,
    name: 'qwen25',
    addGenerationPrompt: true,
    systemPrompt:
      'You are Qwen, created by Alibaba Cloud. You are a helpful assistant.',
  },
  smolLM: {
    name: 'smolLM',
    addGenerationPrompt: true,
    systemPrompt: 'You are a helpful assistant.',
    bosToken: '<|im_start|>',
    eosToken: '<|im_end|>',
    addBosToken: false,
    addEosToken: false,
    chatTemplate: '',
  },
  smolVLM: {
    name: 'smolVLM',
    addGenerationPrompt: true,
    systemPrompt: '',
    bosToken: '<|im_start|>',
    eosToken: '<|im_end|>',
    addBosToken: false,
    addEosToken: false,
    chatTemplate: '',
  },
};

export function getLocalModelDefaultSettings(): {
  chatTemplate: ChatTemplateConfig;
  completionParams: CompletionParams;
} {
  return {
    chatTemplate: chatTemplates.custom,
    completionParams: defaultCompletionParams,
  };
}

export function getHFDefaultSettings(hfModel: HuggingFaceModel): {
  chatTemplate: ChatTemplateConfig;
  completionParams: CompletionParams;
} {
  const _defaultChatTemplate = {
    addBosToken: false, // It is expected that chat templates will take care of this
    addEosToken: false, // It is expected that chat templates will take care of this
    bosToken: hfModel.specs?.gguf?.bos_token ?? '',
    eosToken: hfModel.specs?.gguf?.eos_token ?? '',
    //chatTemplate: hfModel.specs?.gguf?.chat_template ?? '',
    chatTemplate: '', // At the moment chatTemplate needs to be nunjucks, not jinja2. So by using empty string we force the use of gguf's chat template.
    addGenerationPrompt: true,
    systemPrompt: '',
    name: 'custom',
  };

  const _defaultCompletionParams = {
    ...defaultCompletionParams,
    stop: _defaultChatTemplate.eosToken ? [_defaultChatTemplate.eosToken] : [],
  };

  return {
    chatTemplate: _defaultChatTemplate,
    completionParams: _defaultCompletionParams,
  };
}

// Default completion parameters are now defined in settingsVersions.ts

export const stops = [
  '</s>',
  // '<|end|>', conflicts with gpt-oss. Which model uses <|end|>?
  '<|eot_id|>',
  '<|end_of_text|>',
  '<|im_end|>',
  '<|EOT|>',
  '<|END_OF_TURN_TOKEN|>',
  '<|end_of_turn|>',
  '<end_of_turn>',
  '<|endoftext|>',
  '<|return|>', // gpt-oss
  '<|END_RESPONSE|>', // cohere (tiny-aya)
];

/**
 * Removes thinking parts from text content.
 * This function removes content between <think>, <thought>, or <thinking> tags and their closing tags.
 *
 * @param text - The text to process
 * @returns The text with thinking parts removed
 */
export function removeThinkingParts(text: string): string {
  // Check if the text contains any thinking tags
  const hasThinkingTags =
    text.includes('<think>') ||
    text.includes('<thought>') ||
    text.includes('<thinking>');

  // If no thinking tags are found, return the original text
  if (!hasThinkingTags) {
    return text;
  }

  // Remove content between <think> and </think> tags
  let result = text.replace(/<think>[\s\S]*?<\/think>/g, '');

  // Remove content between <thought> and </thought> tags
  result = result.replace(/<thought>[\s\S]*?<\/thought>/g, '');

  // Remove content between <thinking> and </thinking> tags
  result = result.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');

  // Log for debugging
  console.log('Removed thinking parts from context');

  return result;
}

/**
 * Word boundaries for the echo check: whitespace and the punctuation that sits
 * between words. Written as a list rather than `\p{P}` because a release APK
 * runs on a JS engine that may not accept the property escape, and one that
 * throws at parse time takes the module with it.
 */
const ECHO_BOUNDARY_RE = /[\s,.!?;:'"“”«»(){}\[\]…—–_\-/\\]+/;

/**
 * How much of an answer is the question said back.
 *
 * The symptom this measures is a voice model replying to a spoken question by
 * repeating it: the reply is built out of the turn it answers. Exact string
 * comparison cannot see that — a tokenizer leaves `name.` where the input had
 * `name` — so both sides are read as words, and the comparison is of the
 * longest *run* of words the two share in order.
 *
 * A run, not a bag: an answer that borrows `the`, `capital` and `of` from a
 * question it is answering is normal English, and a set-overlap score calls
 * that an echo in every language. `"the capital of france"` standing in the
 * answer unchanged, next to a new word or two, is the failure the user hears.
 *
 * The denominator is the shorter side, so a one-line reply that is the
 * question verbatim scores 1 whatever length the question was.
 */
export function measureEcho(
  reply: string,
  source: string,
): {ratio: number; shared: number; echo: boolean} {
  const asked = source.toLowerCase().split(ECHO_BOUNDARY_RE).filter(Boolean);
  const answer = reply.toLowerCase().split(ECHO_BOUNDARY_RE).filter(Boolean);
  if (!asked.length || !answer.length) {
    return {ratio: 0, shared: 0, echo: false};
  }
  // Longest common contiguous run of words, in the plain DP form: the previous
  // diagonal extended by a match, broken by anything else. Utterances are a
  // few dozen words, so the table is nothing.
  let run = 0;
  let prev = new Array<number>(asked.length + 1).fill(0);
  for (let j = 1; j <= answer.length; j++) {
    const cur = new Array<number>(asked.length + 1).fill(0);
    for (let i = 1; i <= asked.length; i++) {
      if (asked[i - 1] === answer[j - 1]) {
        cur[i] = prev[i - 1] + 1;
        run = Math.max(run, cur[i]);
      }
    }
    prev = cur;
  }
  const ratio = run / Math.min(asked.length, answer.length);
  return {
    ratio: Math.round(ratio * 100) / 100,
    shared: run,
    // Both, because neither alone: three shared words out of four is an echo,
    // and ten shared out of two hundred is a topic.
    echo: run >= 3 && ratio >= 0.7,
  };
}

import * as RNFS from '@dr.pogodin/react-native-fs';

import {chatSessionStore, modelStore, palStore, ttsStore} from '../../store';
import {countMediaParts, measureEcho} from '../../utils/chat';
import {
  ApiCompletionParams,
  CompletionParams,
  toApiCompletionParams,
} from '../../utils/completionTypes';
import {logPerf} from '../../utils/mediaPerf';
import {toLocalMediaPath} from '../../utils/multimodalPatterns';
import {
  TEXT_MODE_INSTRUCTION,
  omniModeGuardFor,
  stripControlTokens,
} from '../../utils/omniMode';
import {
  assembleMessages,
  resolveSystemMessages,
} from '../../utils/systemPromptResolver';
import {DEFAULT_MAX_TURNS} from '../agent';
import type {ToolDefinition} from '../talents/types';
import {collectSystemPromptFragments} from '../talents';

import {VOICE_ANSWER_INSTRUCTION} from './constants';
import {pullableDir, voiceAudioDir} from './wav';

/**
 * A bench that answers one question with numbers instead of reasoning: which
 * part of a spoken turn's prompt makes an Omni model repeat the clip instead of
 * answering it.
 *
 * The device is the only place a real clip and a real projector exist, so the
 * variants run there, back to back, over ONE recorded clip and an empty
 * history. Anything else compares build against build, and a different clip, a
 * different Pal or a stale KV cache moves the answer more than the prompt does.
 */

export type AbVariantId = 'V0' | 'V1' | 'V2' | 'V3';

export interface AbVariant {
  id: AbVariantId;
  label: string;
  /** `Respond with text.` on the system message. */
  textMode: boolean;
  /** The short-answer line, when the setting asks for it. */
  shortAnswer: boolean;
  /** The sampler bans: logit_bias plus the mode stop sequences. */
  bans: boolean;
}

export const AB_VARIANTS: AbVariant[] = [
  {
    id: 'V0',
    label: 'audio only — no instruction, no guard',
    textMode: false,
    shortAnswer: false,
    bans: false,
  },
  {
    id: 'V1',
    label: 'audio only + "Respond with text."',
    textMode: true,
    shortAnswer: false,
    bans: false,
  },
  {
    id: 'V2',
    label: 'current build as-is',
    textMode: true,
    shortAnswer: true,
    bans: true,
  },
  {
    id: 'V3',
    label: 'audio only + logit-bias/stop bans',
    textMode: false,
    shortAnswer: false,
    bans: true,
  },
];

/** Where a recorded clip lives so `adb pull` and the bench see the same file. */
export const abDir = `${pullableDir}/voice-ab`;
export const abClipPath = `${abDir}/clip.wav`;

export interface AbRun {
  variant: AbVariantId;
  n: number;
  ttftMs: number;
  totalMs: number;
  /** Prefill, which is where the audio encoder runs. */
  promptMs: number | null;
  predictedMs: number | null;
  /** Words carried over from an earlier turn. */
  cacheN: number | null;
  tokens: number;
  /** Audio parts in the finished prompt — a replayed clip shows up here. */
  audioParts: number;
  promptChars: number;
  /** A reasoning channel that arrived anyway, in characters. */
  reasoningChars: number;
  /** Control tokens the raw reply carried and the cleaner removed. */
  leaked: boolean;
  raw: string;
  final: string;
  echo: boolean;
  shared: number;
  ratio: number;
  error?: string;
}

export interface AbSummaryRow {
  variant: AbVariantId;
  label: string;
  answered: number;
  echoed: number;
  failed: number;
  medianTtftMs: number;
  medianTotalMs: number;
  medianPromptMs: number;
  sample: string;
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

const median = (values: number[]): number => {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)]);
};

/**
 * The reasoning flags a spoken turn must carry, applied the way the live turn
 * applies them: llama.rn reads `enable_thinking` at the top level before it
 * merges the template kwargs, and a template that branches on it — LFM3-Omni
 * ends the generation prompt with an unclosed `<think>` unless told off —
 * leaves the model a state it cannot finish unless both say off.
 */
export const applySpokenReasoningFlags = (
  params: ApiCompletionParams,
): ApiCompletionParams => {
  const next: ApiCompletionParams = {...params, reasoning_format: 'auto'};
  if (!next.enable_thinking) {
    next.enable_thinking = false;
    next.chat_template_kwargs = {
      ...next.chat_template_kwargs,
      enable_thinking: false,
    };
  }
  return next;
};

/**
 * The turn as the model will receive it. Nothing here invents a shape: it is
 * the assembly the live spoken turn uses, with each instruction switched by the
 * variant and the history left empty — a poisoned history is one of the things
 * being tested for, so the bench has to be able to rule it out.
 */
export const buildAbTurn = ({
  variant,
  clipPath,
  systemMessages,
  guard,
  shortAnswerOn,
  stopWords,
  toolNames = [],
  now = new Date(),
}: {
  variant: AbVariant;
  clipPath: string;
  systemMessages: Array<{role: 'system'; content: string}>;
  guard: Awaited<ReturnType<typeof omniModeGuardFor>>;
  shortAnswerOn: boolean;
  stopWords?: string[];
  toolNames?: string[];
  now?: Date;
}): {
  messages: ReturnType<typeof assembleMessages>;
  params: CompletionParams;
} => {
  const fragments = [
    ...collectSystemPromptFragments(toolNames, {
      now,
      maxToolTurns: DEFAULT_MAX_TURNS,
    }),
    ...(variant.textMode ? [TEXT_MODE_INSTRUCTION] : []),
    ...(variant.shortAnswer && shortAnswerOn ? [VOICE_ANSWER_INSTRUCTION] : []),
  ];

  // The clip alone, exactly as the live turn builds it: nothing beside it to
  // answer with instead of answering the sound. The content array is untyped
  // because the app's ChatMessage union predates an audio part.
  const turn = {
    role: 'user',
    content: [
      {
        type: 'input_audio',
        input_audio: {url: toLocalMediaPath(clipPath), format: 'wav'},
      },
    ],
  };

  const messages = assembleMessages(systemMessages, fragments, [turn]);

  const params: CompletionParams = {
    messages: messages as unknown as CompletionParams['messages'],
    // Every variant stands in for a spoken turn, and a spoken turn must not
    // spend its first second on a reasoning pass.
    enable_thinking: false,
    reasoning: {enabled: false},
    ...(variant.bans && guard
      ? {
          stop: [...(stopWords ?? []), ...guard.stopWords],
          logit_bias: guard.logitBias,
        }
      : {}),
  };

  return {messages, params};
};

/** Newest clip the recorder left behind, for saving as the fixed bench clip. */
export const saveNewestClip = async (): Promise<string> => {
  const items = await RNFS.readdir(voiceAudioDir);
  const clips = items
    .filter(name => name.endsWith('.wav'))
    .sort()
    .reverse();
  if (!clips.length) {
    throw new Error('no recorded clip yet — speak once in voice mode first');
  }
  await RNFS.mkdir(abDir);
  await RNFS.copyFile(`${voiceAudioDir}/${clips[0]}`, abClipPath);
  return clips[0];
};

const clipBytes = async (): Promise<number> => {
  try {
    const stat = await RNFS.stat(abClipPath);
    return Number(stat.size) || 0;
  } catch {
    return 0;
  }
};

export const runAbBench = async ({
  runs = 5,
  expectText = '',
  isCancelled,
  onLine,
}: {
  runs?: number;
  expectText?: string;
  isCancelled?: () => boolean;
  onLine?: (line: string) => void;
}): Promise<{rows: AbRun[]; summary: AbSummaryRow[]}> => {
  const say = (line: string) => {
    console.log(`[voice-ab] ${line}`);
    onLine?.(line);
  };

  if (!modelStore.engine) {
    throw new Error('no local model loaded — load the Omni model first');
  }
  const clip = await clipBytes();
  if (!clip) {
    throw new Error(`no bench clip at ${abClipPath}`);
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

  const guard = await omniModeGuardFor(modelStore.context);
  const stopWords = modelStore.activeModel?.stopWords;
  const settings = await chatSessionStore.getCurrentCompletionSettings();
  const shortAnswerOn = ttsStore.voiceShortAnswers;
  const toolNames = (
    (settings.tools as ToolDefinition[] | undefined) ?? []
  ).map(tool => tool.function?.name ?? '');

  logPerf('ab.clip', {
    clip,
    runs,
    variants: AB_VARIANTS.map(v => v.id).join(','),
    guard: guard ? `${guard.logitBias.length} banned` : 'none',
    shortAnswer: shortAnswerOn ? 'on' : 'off',
    expect: oneLine(expectText).slice(0, 60),
  });

  const rows: AbRun[] = [];
  // The prompt as the template really rendered it, kept whole in the dump: the
  // log line has to stay on one line for logcat, but the structure of a prompt
  // — where the clip marker sits against the words — is the evidence.
  const prompts: Partial<Record<AbVariantId, string>> = {};

  for (const variant of AB_VARIANTS) {
    const built = buildAbTurn({
      variant,
      clipPath: abClipPath,
      systemMessages,
      guard,
      shortAnswerOn,
      stopWords,
      toolNames,
    });
    const merged: CompletionParams = {
      ...settings,
      ...built.params,
    };
    const params = applySpokenReasoningFlags(toApiCompletionParams(merged));

    // Every media part in the finished prompt: one clip is the rule, and a
    // second is the replay this bench exists to catch.
    const media = countMediaParts(params.messages);

    // The chat template runs natively, so this is the only place the real
    // prompt is visible — the only thing that settles where the words sit
    // against the clip. Rendered once per variant; the shape does not change
    // between runs of the same one.
    let promptChars = 0;
    if (!rows.some(row => row.variant === variant.id)) {
      try {
        const formatted = await modelStore.context?.getFormattedChat?.(
          params.messages ?? [],
          null,
          {jinja: true},
        );
        const prompt =
          typeof formatted === 'string'
            ? formatted
            : String(formatted?.prompt ?? '');
        promptChars = prompt.length;
        prompts[variant.id] = prompt;
        say(
          `ab.fullprompt ${variant.id} audio=${media.audio} :: ${oneLine(
            prompt,
          )}`,
        );
      } catch (error) {
        say(`ab.fullprompt ${variant.id} unavailable (${String(error)})`);
      }
      say(
        `ab.flags ${variant.id} enable_thinking=${String(
          params.enable_thinking,
        )} kwargs=${JSON.stringify(params.chat_template_kwargs ?? null)} ` +
          `format=${String(params.reasoning_format)} banned=${
            params.logit_bias?.length ?? 0
          } stop=${params.stop?.length ?? 0} audio=${
            media.audio
          } chars=${promptChars}`,
      );
    }

    for (let n = 1; n <= runs; n++) {
      if (isCancelled?.()) {
        say('cancelled');
        break;
      }
      const started = Date.now();
      let ttftMs = -1;
      let streamed = '';
      let reasoningChars = 0;
      try {
        const result = await modelStore.engine.completion(params, data => {
          const token = data?.token ?? data?.content ?? '';
          reasoningChars += data?.reasoning_content?.length ?? 0;
          if (ttftMs < 0 && token) {
            ttftMs = Date.now() - started;
          }
          streamed += token;
        });
        const raw = result?.text ?? streamed;
        const final = stripControlTokens(raw).trim();
        const verdict = expectText.trim()
          ? measureEcho(final, expectText)
          : {ratio: 0, shared: 0, echo: false};
        const run: AbRun = {
          variant: variant.id,
          n,
          ttftMs,
          totalMs: Date.now() - started,
          promptMs: result?.timings?.prompt_ms ?? null,
          predictedMs: result?.timings?.predicted_ms ?? null,
          cacheN: result?.timings?.cache_n ?? null,
          tokens: result?.timings?.predicted_n ?? 0,
          audioParts: media.audio,
          promptChars,
          reasoningChars,
          leaked: final !== raw.trim(),
          raw: oneLine(raw).slice(0, 400),
          final: oneLine(final).slice(0, 240),
          echo: verdict.echo,
          shared: verdict.shared,
          ratio: verdict.ratio,
        };
        rows.push(run);
        say(
          `${variant.id}#${n} audio=${run.audioParts} ttft=${run.ttftMs}ms ` +
            `total=${run.totalMs}ms prefill=${run.promptMs ?? '-'}ms ` +
            `cached=${run.cacheN ?? '-'} think=${run.reasoningChars}c ` +
            `leak=${run.leaked ? 'YES' : 'no'} echo=${
              run.echo ? 'YES' : 'no'
            } :: ${run.final}`,
        );
      } catch (error) {
        rows.push({
          variant: variant.id,
          n,
          ttftMs: -1,
          totalMs: Date.now() - started,
          promptMs: null,
          predictedMs: null,
          cacheN: null,
          tokens: 0,
          audioParts: media.audio,
          promptChars,
          reasoningChars,
          leaked: false,
          raw: '',
          final: '',
          echo: false,
          shared: 0,
          ratio: 0,
          error: String(error),
        });
        say(`${variant.id}#${n} FAILED ${String(error)}`);
      }
    }
  }

  const summary = AB_VARIANTS.map(variant => {
    const mine = rows.filter(row => row.variant === variant.id);
    const ok = mine.filter(row => !row.error);
    return {
      variant: variant.id,
      label: variant.label,
      answered: ok.filter(row => !row.echo && row.final.length > 0).length,
      echoed: ok.filter(row => row.echo).length,
      failed: mine.length - ok.length,
      medianTtftMs: median(ok.map(row => row.ttftMs)),
      medianTotalMs: median(ok.map(row => row.totalMs)),
      medianPromptMs: median(
        ok.map(row => row.promptMs).filter((v): v is number => v !== null),
      ),
      sample: oneLine(ok[0]?.final ?? ok[0]?.raw ?? '-').slice(0, 80),
    };
  });

  say('---- variant table ----');
  summary.forEach(row =>
    say(
      `${row.variant} ${row.label}: answered=${row.answered} echo=${
        row.echoed
      } failed=${row.failed} ttft=${row.medianTtftMs}ms total=${
        row.medianTotalMs
      }ms prefill=${row.medianPromptMs}ms :: ${row.sample}`,
    ),
  );

  const dump = `${abDir}/results-${Date.now()}.json`;
  await RNFS.writeFile(
    dump,
    JSON.stringify({clip, expectText, prompts, rows, summary}, null, 1),
  )
    .then(() => say(`saved ${dump}`))
    .catch(err => console.warn('[voice-ab] results dump failed:', err));

  return {rows, summary};
};

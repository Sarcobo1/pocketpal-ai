import {countMediaParts} from '../../../utils/chat';
import {
  BAN_TOKEN,
  MODE_SWITCH_TOKENS,
  TEXT_MODE_INSTRUCTION,
} from '../../../utils/omniMode';
import type {OmniModeGuard} from '../../../utils/omniMode';

import {VOICE_ANSWER_INSTRUCTION, VOICE_AUDIO_INSTRUCTION} from '../constants';
import {AB_VARIANTS, applySpokenReasoningFlags, buildAbTurn} from '../abBench';

/**
 * The prompt shapes the spoken-turn A/B bench runs, pinned.
 *
 * The bench decides which instruction set stays in the app, so its own shape
 * cannot rest on the device it runs on: one clip in the prompt, no history,
 * thinking off, and each instruction present in exactly the variants that claim
 * to be testing it.
 */

// The guard the probe returns for a model whose vocab carries the mode tokens.
const GUARD: OmniModeGuard = {
  logitBias: [
    [6, BAN_TOKEN],
    [7, BAN_TOKEN],
  ],
  stopWords: [MODE_SWITCH_TOKENS[0], MODE_SWITCH_TOKENS[1]],
  ids: {[MODE_SWITCH_TOKENS[0]]: 6, [MODE_SWITCH_TOKENS[1]]: 7},
};

const SYSTEM = [
  {role: 'system' as const, content: 'You are a helpful assistant.'},
];

const CLIP = '/sdcard/Android/data/com.pocketpalai/files/voice-ab/clip.wav';

const build = (
  id: string,
  over: Partial<Parameters<typeof buildAbTurn>[0]> = {},
) => {
  const variant = AB_VARIANTS.find(v => v.id === id);
  if (!variant) {
    throw new Error('unknown variant ' + id);
  }
  return buildAbTurn({
    variant,
    clipPath: CLIP,
    systemMessages: SYSTEM,
    guard: GUARD,
    shortAnswerOn: true,
    stopWords: ['stop-one'],
    now: new Date('2026-11-04T00:00:00.000Z'),
    ...over,
  });
};

const systemText = (messages: Array<{role: string; content?: unknown}>) =>
  String(messages.find(m => m.role === 'system')?.content ?? '');

const lastTurn = (messages: Array<{role: string; content?: unknown}>) =>
  messages[messages.length - 1];

describe('spoken-turn A/B prompt shapes', () => {
  it.each(['V0', 'V1', 'V2', 'V3'])('%s asks one clip and no history', id => {
    const {messages} = build(id);
    // A second audio part is the replay bug, and a row before the user turn is
    // history poisoning — the two things the bench has to be able to rule out.
    expect(countMediaParts(messages as never)).toEqual({images: 0, audio: 1});
    expect(messages).toHaveLength(2);
    expect(lastTurn(messages).role).toBe('user');
  });

  it.each(['V0', 'V1', 'V2', 'V3'])(
    '%s sends the recorded clip by path, as the live turn does',
    id => {
      const {messages} = build(id);
      const parts = lastTurn(messages).content as Array<{
        type: string;
        input_audio?: {url: string; format: string};
      }>;
      expect(parts[0]).toEqual({
        type: 'input_audio',
        input_audio: {url: CLIP, format: 'wav'},
      });
    },
  );

  it.each(['V0', 'V1', 'V2', 'V3'])(
    '%s is the clip alone: no words beside it to answer with',
    id => {
      const {messages} = build(id);
      const parts = lastTurn(messages).content as Array<{type: string}>;
      expect(parts.filter(part => part.type === 'text')).toEqual([]);
      // The line that used to stand beside the clip is the one a weak-clip
      // reply quoted back as the question. It reaches no prompt at all now.
      const prompt = JSON.stringify(messages);
      expect(prompt).not.toContain(VOICE_AUDIO_INSTRUCTION);
      expect(prompt).not.toContain('Do not repeat or transcribe');
    },
  );

  it('V0 says nothing beside the clip and nothing on the system message', () => {
    const {messages, params} = build('V0');
    expect(systemText(messages)).toBe(SYSTEM[0].content);
    expect(params.logit_bias).toBeUndefined();
    expect(params.stop).toBeUndefined();
  });

  it('V1 adds only the mode instruction, at the end of the system message', () => {
    const {messages} = build('V1');
    expect(systemText(messages)).toBe(
      `${SYSTEM[0].content}\n\n${TEXT_MODE_INSTRUCTION}`,
    );
    expect(systemText(messages)).not.toContain(VOICE_ANSWER_INSTRUCTION);
  });

  it('V2 is the current build: both system lines, in order, and the bans', () => {
    const {messages, params} = build('V2');
    expect(systemText(messages)).toBe(
      [SYSTEM[0].content, TEXT_MODE_INSTRUCTION, VOICE_ANSWER_INSTRUCTION].join(
        '\n\n',
      ),
    );
    expect(params.stop).toEqual(['stop-one', ...GUARD.stopWords]);
    expect(params.logit_bias).toEqual(GUARD.logitBias);
  });

  it('V3 bans at the sampler without saying anything in the prompt', () => {
    const {messages, params} = build('V3');
    expect(systemText(messages)).toBe(SYSTEM[0].content);
    expect(lastTurn(messages).content).toEqual([
      expect.objectContaining({type: 'input_audio'}),
    ]);
    expect(params.logit_bias).toEqual(GUARD.logitBias);
    expect(params.stop).toEqual(['stop-one', ...GUARD.stopWords]);
  });

  it('leaves the short-answer line out when the setting is off', () => {
    const {messages} = build('V2', {shortAnswerOn: false});
    expect(systemText(messages)).toBe(
      `${SYSTEM[0].content}\n\n${TEXT_MODE_INSTRUCTION}`,
    );
  });

  it('changes no parameter for a model whose vocab carries no speech mode', () => {
    const {params} = build('V2', {guard: null});
    expect(params.logit_bias).toBeUndefined();
    expect(params.stop).toBeUndefined();
  });

  it.each(['V0', 'V1', 'V2', 'V3'])(
    '%s stands in for a spoken turn, so thinking is off',
    id => {
      const {params} = build(id);
      expect(params.enable_thinking).toBe(false);
      expect(params.reasoning).toEqual({enabled: false});
    },
  );
});

describe('applySpokenReasoningFlags', () => {
  it('mirrors the live spoken turn: auto format, thinking off in both places', () => {
    const next = applySpokenReasoningFlags({
      messages: [],
      enable_thinking: false,
    });
    expect(next.reasoning_format).toBe('auto');
    expect(next.enable_thinking).toBe(false);
    expect(next.chat_template_kwargs).toEqual({enable_thinking: false});
  });

  it('keeps a template kwarg the session already set', () => {
    const next = applySpokenReasoningFlags({
      messages: [],
      chat_template_kwargs: {do_sample: true},
    });
    expect(next.chat_template_kwargs).toEqual({
      do_sample: true,
      enable_thinking: false,
    });
  });

  it('does not turn thinking off on a turn that asked for it', () => {
    const next = applySpokenReasoningFlags({
      messages: [],
      enable_thinking: true,
      chat_template_kwargs: {enable_thinking: true},
    });
    expect(next.enable_thinking).toBe(true);
    expect(next.chat_template_kwargs).toEqual({enable_thinking: true});
  });
});

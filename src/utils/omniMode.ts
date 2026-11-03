/**
 * LFM3-Omni answers in one of three modes and announces which one it chose with
 * a control token: the audio-start token opens speech-only output,
 * `<|mixed_start|>` opens the interleaved text+audio mode, and `<|text_end|>`
 * closes the text half of an interleaved block.
 *
 * A plain text completion has no audio pipeline. When the model enters either
 * speech mode inside one, it waits for audio frames that will never arrive, so
 * `<|text_end|>` comes out again and again and the turn never reaches the end of
 * the response. Reaching that mode is the model's own default: the card
 * says it "selects the output modality based on the system prompt and input
 * modality, typically matching the input modality", which is why a spoken
 * question is exactly where this shows up.
 *
 * Two things close it, and both belong to whoever owns the sampler, not to a
 * caller that happens to remember:
 * - the mode tokens are banned at sampling time for any model whose vocab
 *   carries them, mirroring what llama.cpp's own mtmd helper does for TEXT mode
 *   (`tools/mtmd/mtmd-helper-gen.cpp`: `logit_bias = {{tok_audio_start,
 *   -INFINITY}, {tok_mixed_start, -INFINITY}}`),
 * - the system prompt carries `Respond with text.`, the instruction the model
 *   card gives for a text-only answer.
 *
 * The ids are resolved from the live vocab rather than hardcoded, so a text-only
 * model — whose tokenizer splits these strings into ordinary pieces — is left
 * exactly as it was.
 */

import {logPerf} from './mediaPerf';

/**
 * The control tokens in this vocabulary are named here rather than spelled out,
 * because the whole point is that a token that is NOT one piece of this vocab
 * must not be banned. Composing them keeps the name and the wrapping in one
 * place.
 */
const MODE_SWITCH_NAMES = ['audio_start', 'mixed_start', 'text_end'] as const;

/** The tokens that switch an LFM3-Omni reply out of text. */
export const MODE_SWITCH_TOKENS: readonly string[] = MODE_SWITCH_NAMES.map(
  name => `<|${name}|>`,
);

/**
 * Bias that makes a token unproducible. llama.rn's `logit_bias` accepts `false`
 * for exactly that and turns it into `-INFINITY` natively; this stays inside the
 * declared `Array<Array<number>>` type and is far past any real logit, so the
 * softmax drops the token to zero.
 */
export const BAN_TOKEN = -1e30;

/** A leaked control token is never part of an answer worth keeping. */
const CONTROL_TOKEN_RE = /<\|[^<>|]{1,40}\|>/g;

/**
 * A token still arriving: a streaming snapshot can end halfway through one, and
 * the half-token is what the user would see flicker. The next snapshot re-derives
 * the whole string, so nothing real is lost — and a finished turn never ends on
 * an incomplete token, because that is the leak this file exists for.
 */
const PARTIAL_TOKEN_TAIL_RE = /<\|[^<>|]{0,40}$/;

/**
 * How many times one control token may repeat before the reply is called a
 * loop. A single stray token is a leak to clean up; a third is a model that has
 * found an exit it cannot leave, so the next one ends the turn.
 */
export const MAX_CONTROL_TOKEN_REPEATS = 3;

/**
 * A reply this long is not an answer whatever it contains — a runaway turn can
 * run to the context limit and stream for minutes.
 */
export const MAX_REPLY_CHARS = 24000;

/**
 * What the model card tells the prompt to ask for when the answer must be text.
 * Only ever appended to an existing system prompt, never a replacement: the
 * card's own examples put it at the end of whatever else is there.
 */
export const TEXT_MODE_INSTRUCTION = 'Respond with text.';

export interface OmniModeGuard {
  /** `logit_bias` entries, one per token this vocab actually carries. */
  logitBias: Array<Array<number>>;
  /** Stop sequences to add, one per token this vocab carries. */
  stopWords: string[];
  /** Token id per control token, for reporting. */
  ids: Record<string, number>;
}

/**
 * The part of a live context this file needs: an identity, so the probe is paid
 * for once per loaded model, and a tokenizer, which is the only thing that can
 * say whether a control token is one token here or a sentence of pieces.
 */
export interface OmniTokenProbe {
  id: number;
  tokenize: (
    text: string,
    opts?: {media_paths?: string[]},
  ) => Promise<{tokens: number[]}>;
}

/**
 * Resolve the mode tokens against a live context and build the guard.
 *
 * `tokenize` runs natively with `parse_special=true` and no added special
 * tokens, so a string that is one control token in this vocab comes back as
 * exactly one id; anything else is split into pieces and so is not this model's
 * token. Returns null when none of them exist — which is every text-only model,
 * and means no parameter changes at all.
 */
export const resolveOmniModeGuard = async (
  ctx: OmniTokenProbe | null | undefined,
  tokens: readonly string[] = MODE_SWITCH_TOKENS,
): Promise<OmniModeGuard | null> => {
  if (!ctx) {
    return null;
  }
  const ids: Record<string, number> = {};
  for (const token of tokens) {
    let resolved: number[] = [];
    try {
      resolved = (await ctx.tokenize(token)).tokens ?? [];
    } catch {
      // No tokenizer answer is not a licence to ban a guessed id.
      return null;
    }
    if (resolved.length !== 1 || resolved[0] < 0) {
      continue;
    }
    ids[token] = resolved[0];
  }
  const found = Object.entries(ids);
  if (found.length === 0) {
    return null;
  }
  return {
    logitBias: found.map(([, id]) => [id, BAN_TOKEN]),
    stopWords: found.map(([token]) => token),
    ids,
  };
};

let guardCache: {
  contextId: number;
  guard: OmniModeGuard | null;
} | null = null;

/**
 * The guard for the context that is loaded right now, probed once per context.
 *
 * The answer belongs to the model in memory, not to the turn, and a turn is not
 * the place to pay for three tokenizations. Logging what was found is the point
 * of the probe: "this model has no speech mode" and "this build did not look"
 * are different bugs, and only the second line tells them apart.
 */
export const omniModeGuardFor = async (
  ctx: Parameters<typeof resolveOmniModeGuard>[0],
): Promise<OmniModeGuard | null> => {
  if (!ctx) {
    return null;
  }
  // The cache has to exist before its id can match: a context with no id at
  // all — a stand-in, an engine that has not finished building — would compare
  // `undefined === undefined` against the empty cache and read a guard out of
  // nothing.
  if (guardCache && guardCache.contextId === ctx.id) {
    return guardCache.guard;
  }
  const guard = await resolveOmniModeGuard(ctx);
  guardCache = {contextId: ctx.id, guard};
  logPerf('omni.mode', {
    ids: guard ? JSON.stringify(guard.ids) : 'none',
    banned: guard ? guard.logitBias.length : 0,
  });
  return guard;
};

/** Drop the probe when a context goes away, so a new model is asked again. */
export const resetOmniModeGuard = (): void => {
  guardCache = null;
};

/**
 * Drop every `<|...|>` control token from text.
 *
 * Used on what the user sees, what a voice says, what gets stored, and what goes
 * back into the next prompt: a token that survives into history keeps teaching
 * the model that leaking one is the right thing to do.
 *
 * A token is replaced by a space rather than nothing, because a control token
 * sits between two segments — the mode switch comes after one sentence and
 * before the next — and deleting it outright would weld `привет` to the word
 * that followed. Runs of spaces then go, so the seam is invisible.
 */
export const stripControlTokens = (text: string): string => {
  if (!text || !text.includes('<|')) {
    return text;
  }
  return text
    .replace(CONTROL_TOKEN_RE, ' ')
    .replace(PARTIAL_TOKEN_TAIL_RE, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
};

/**
 * Detect a reply stuck repeating a control token instead of answering.
 *
 * The count is taken from the text itself, not from token ids, because that is
 * what a streaming caller has at every token — and the leak is precisely what
 * makes it climb. Returns the token that looped, `'length'` past the size cap,
 * or null.
 */
export const controlTokenLoop = (
  text: string,
  maxRepeats: number = MAX_CONTROL_TOKEN_REPEATS,
  maxChars: number = MAX_REPLY_CHARS,
): string | null => {
  if (text.length > maxChars) {
    return 'length';
  }
  const matches = text.match(CONTROL_TOKEN_RE);
  if (!matches) {
    return null;
  }
  for (const token of new Set(matches)) {
    if (matches.filter(found => found === token).length > maxRepeats) {
      return token;
    }
  }
  return null;
};

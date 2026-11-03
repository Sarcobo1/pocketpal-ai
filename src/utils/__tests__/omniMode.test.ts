import {
  BAN_TOKEN,
  controlTokenLoop,
  MAX_CONTROL_TOKEN_REPEATS,
  MAX_REPLY_CHARS,
  MODE_SWITCH_TOKENS,
  omniModeGuardFor,
  resetOmniModeGuard,
  resolveOmniModeGuard,
  stripControlTokens,
  TEXT_MODE_INSTRUCTION,
} from '../omniMode';

// The list is composed from names, so the tests read it back by index rather
// than repeating a token string that a source edit could silently mistype.
const AUDIO_START = MODE_SWITCH_TOKENS[0];
const MIXED_START = MODE_SWITCH_TOKENS[1];
const TEXT_END = MODE_SWITCH_TOKENS[2];

/**
 * The ids the LFM3-Omni-2B vocabulary gives these three, taken from the
 * published GGUF's tokenizer metadata rather than assumed. They are fixtures
 * only: the guard resolves ids from the running model and never trusts a number,
 * which is the whole reason a text-only model can be left exactly as it was.
 */
const OMNI_IDS: Record<string, number> = {
  [AUDIO_START]: 125012,
  [MIXED_START]: 125015,
  [TEXT_END]: 125014,
};

/** A context whose tokenizer keeps a control token as one piece: an omni model. */
const omniContext = (id = 1) => ({
  id,
  tokenize: jest.fn(async (text: string) => ({
    tokens: text in OMNI_IDS ? [OMNI_IDS[text]] : [101, 102, 103],
  })),
});

/**
 * A text-only vocab splits the same string into words and subwords. That is the
 * only difference between "this model has no speech mode" and "the id is
 * unknown", and the only reason a text-only model stays untouched.
 */
const textOnlyContext = (id = 2) => ({
  id,
  tokenize: jest.fn(async () => ({tokens: [101, 102, 103]})),
});

afterEach(() => resetOmniModeGuard());

describe('the mode token list', () => {
  it('names only wrapped control tokens', () => {
    expect(MODE_SWITCH_TOKENS).toHaveLength(3);
    for (const token of MODE_SWITCH_TOKENS) {
      expect(token.startsWith('<|')).toBe(true);
      expect(token.endsWith('|>')).toBe(true);
    }
  });

  it('leaves the end-of-response token out of the list', () => {
    // Removing the token that closes a turn would stop every reply short.
    expect(MODE_SWITCH_TOKENS.some(token => token.includes('im_end'))).toBe(
      false,
    );
  });
});

describe('resolveOmniModeGuard', () => {
  it('bans each mode token at the id this vocab gives it', async () => {
    const guard = await resolveOmniModeGuard(omniContext());
    expect(guard?.logitBias).toEqual([
      [125012, BAN_TOKEN],
      [125015, BAN_TOKEN],
      [125014, BAN_TOKEN],
    ]);
    expect(guard?.stopWords).toEqual([AUDIO_START, MIXED_START, TEXT_END]);
  });

  it('asks the tokenizer, and hardcodes no id of its own', async () => {
    const ctx = omniContext();
    await resolveOmniModeGuard(ctx);
    expect(ctx.tokenize).toHaveBeenCalledTimes(MODE_SWITCH_TOKENS.length);
    expect(ctx.tokenize).toHaveBeenCalledWith(MIXED_START);
  });

  it('leaves a text-only model with nothing to apply', async () => {
    expect(await resolveOmniModeGuard(textOnlyContext())).toBeNull();
  });

  it('bans only the tokens present when a vocab carries some of them', async () => {
    const partial = {
      id: 3,
      tokenize: jest.fn(async (text: string) => ({
        tokens: text === TEXT_END ? [9] : [1, 2, 3],
      })),
    };
    const guard = await resolveOmniModeGuard(partial);
    expect(guard?.logitBias).toEqual([[9, BAN_TOKEN]]);
    expect(guard?.stopWords).toEqual([TEXT_END]);
  });

  it('refuses to guess when the tokenizer does not answer', async () => {
    const broken = {
      id: 4,
      tokenize: jest.fn(async () => {
        throw new Error('no tokenizer');
      }),
    };
    expect(await resolveOmniModeGuard(broken)).toBeNull();
  });

  it('does nothing without a context', async () => {
    expect(await resolveOmniModeGuard(null)).toBeNull();
    expect(await omniModeGuardFor(undefined)).toBeNull();
  });
});

describe('omniModeGuardFor', () => {
  it('probes a context that carries no id instead of hitting an empty cache', async () => {
    // An engine stand-in has no context identity, which used to read as a cache
    // hit against no cache at all — `undefined === undefined`, then a property
    // read on nothing. Such a turn is meant to get a guard, not to throw.
    const source = omniContext();
    const ctx = {...source, id: undefined};

    const guard = await omniModeGuardFor(ctx as any);

    expect(guard?.stopWords).toEqual([...MODE_SWITCH_TOKENS]);
    expect(ctx.tokenize).toHaveBeenCalledTimes(MODE_SWITCH_TOKENS.length);
  });

  it('probes a context once and reuses the answer for its turns', async () => {
    const ctx = omniContext(7);
    const first = await omniModeGuardFor(ctx);
    const second = await omniModeGuardFor(ctx);
    expect(second).toEqual(first);
    expect(ctx.tokenize).toHaveBeenCalledTimes(MODE_SWITCH_TOKENS.length);
  });

  it('re-probes when a different model is loaded', async () => {
    const omni = omniContext(1);
    await omniModeGuardFor(omni);
    const textOnly = textOnlyContext(2);
    expect(await omniModeGuardFor(textOnly)).toBeNull();
    expect(textOnly.tokenize).toHaveBeenCalled();
  });

  it('caches a text-only model too, so turns stay cheap', async () => {
    const ctx = textOnlyContext(5);
    expect(await omniModeGuardFor(ctx)).toBeNull();
    expect(await omniModeGuardFor(ctx)).toBeNull();
    expect(ctx.tokenize).toHaveBeenCalledTimes(MODE_SWITCH_TOKENS.length);
  });
});

describe('stripControlTokens', () => {
  it('reads the device leak as the reply it should have been', () => {
    const leaked = `${MIXED_START}Здравствуйте,${TEXT_END}привет${TEXT_END}品!${TEXT_END}${TEXT_END}`;
    expect(stripControlTokens(leaked)).toBe('Здравствуйте, привет 品!');
  });

  it('removes the audio-start token like any other control token', () => {
    expect(stripControlTokens(`да${AUDIO_START}нет`)).toBe('да нет');
  });

  it('keeps the words a token separated apart, instead of welding them', () => {
    expect(stripControlTokens('a<|made_up|>b')).toBe('a b');
  });

  it('leaves a streaming snapshot that has not reached the token alone', () => {
    expect(stripControlTokens('hello world')).toBe('hello world');
    expect(stripControlTokens('')).toBe('');
  });

  it('hides a token still arriving, so it never flashes on screen', () => {
    // The next snapshot re-derives the whole string, so nothing real is lost.
    expect(stripControlTokens(`yes ${MIXED_START.slice(0, -2)}`)).toBe('yes');
  });

  it('keeps ordinary angle brackets that are not a control token', () => {
    expect(stripControlTokens('x < 1 | y > 2')).toBe('x < 1 | y > 2');
    expect(stripControlTokens('a<b>c')).toBe('a<b>c');
  });
});

describe('controlTokenLoop', () => {
  it('tolerates a stray token but not a fourth', () => {
    const one = TEXT_END.repeat(MAX_CONTROL_TOKEN_REPEATS);
    expect(controlTokenLoop(one)).toBeNull();
    expect(
      controlTokenLoop(TEXT_END.repeat(MAX_CONTROL_TOKEN_REPEATS + 1)),
    ).toBe(TEXT_END);
  });

  it('counts each token on its own, not the total leaks', () => {
    const mixed = MIXED_START + TEXT_END + MIXED_START + TEXT_END;
    expect(controlTokenLoop(mixed)).toBeNull();
  });

  it('stops the device loop even though it is short', () => {
    const reply = `${MIXED_START}Здравствуйте,${TEXT_END}`;
    // The leak the report describes: one token, then the same one forever.
    expect(controlTokenLoop(reply)).toBeNull();
    expect(controlTokenLoop(reply + TEXT_END.repeat(4))).toBe(TEXT_END);
  });

  it('catches a reply that runs on with no token at all', () => {
    expect(controlTokenLoop('х'.repeat(MAX_REPLY_CHARS + 1))).toBe('length');
    expect(controlTokenLoop('a short answer')).toBeNull();
  });

  it('ignores a partial token at the end of a snapshot', () => {
    expect(
      controlTokenLoop('x'.repeat(3) + MIXED_START.slice(0, -3)),
    ).toBeNull();
  });
});

describe('the text-mode instruction', () => {
  it('is the wording the model card uses for a text-only answer', () => {
    expect(TEXT_MODE_INSTRUCTION).toBe('Respond with text.');
    expect(TEXT_MODE_INSTRUCTION.endsWith('.')).toBe(true);
  });

  it('bans with a bias no real logit can survive', () => {
    expect(BAN_TOKEN).toBeLessThan(-1e20);
    expect(Number.isFinite(BAN_TOKEN)).toBe(true);
  });
});

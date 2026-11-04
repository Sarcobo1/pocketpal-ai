import {
  DEFAULT_JITTER_SECONDS,
  DEFAULT_MAX_JITTER_SECONDS,
  DEFAULT_MAX_SEGMENT_SECONDS,
  DEFAULT_MIN_SEGMENT_SECONDS,
  SPEECH_CHARS_PER_SECOND,
  firstSpokenSentence,
  openSpeechFeed,
  planSpeechBoundaries,
  type SpeechFeed,
} from '../speechStream';
import type {SinkMode, VoiceSink, VoiceSinkStats} from '../streamSink';

/**
 * A streamed reply is only as good as where it is cut and how full the buffer
 * was when it began. These tests hold the clock and the output in hand so each
 * of those decisions is observable: the wait for the first piece, the pause a
 * piece is cut in, the hole the output goes dry leaving, the boundary a slow
 * reply stops at and the words it hands to the device voice.
 */

const RATE = 24000;
const SAMPLES = (ms: number) => Math.round((RATE * ms) / 1000);
/** Above the quiet floor: a loud enough frame is speech for these purposes. */
const voiced = (ms: number) => new Float32Array(SAMPLES(ms)).fill(0.3);
/** Digital silence, which is what a pause is made of here. */
const pause = (ms: number) => new Float32Array(SAMPLES(ms));
const msOf = (buffer: Float32Array) => (buffer.length / RATE) * 1000;
const secondsOf = (buffer: Float32Array) => buffer.length / RATE;
const concat = (parts: Float32Array[]) => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const all = new Float32Array(total);
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.length;
  }
  return all;
};

const sinkStats = (over: Partial<VoiceSinkStats> = {}): VoiceSinkStats => ({
  mode: 'stream' as SinkMode,
  segments: 0,
  underruns: 0,
  nativeUnderruns: 0,
  dryMs: 0,
  gapMs: 0,
  gapMaxMs: 0,
  bridgeMs: 0,
  error: '',
  ...over,
});

/** An output that records what it was handed and never plays anything. */
const makeSink = (stats: Partial<VoiceSinkStats> = {}) => {
  const chunks: Float32Array[] = [];
  const sink: VoiceSink = {
    write: samples => {
      chunks.push(samples);
    },
    end: jest.fn(async () => sinkStats(stats)),
    abort: jest.fn(),
  };
  return {sink, chunks};
};

let now = 0;
beforeEach(() => {
  now = 1_700_000_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => {
  jest.restoreAllMocks();
});

const advance = (ms: number) => {
  now += ms;
};

/**
 * One decoded chunk, with the engine taking `pace` ms of work per ms of audio
 * it made: 0.8 is a model ahead of real time, 3 is one that cannot keep up.
 */
const chunk = (feed: SpeechFeed, samples: Float32Array, pace = 0.8) => {
  advance(Math.round(msOf(samples) * pace));
  feed.push(samples, RATE);
};

/** Seconds of audio the output was handed, in the order it heard them. */
const pieces = (chunks: Float32Array[]) =>
  chunks.map(buffer => ({
    seconds: secondsOf(buffer),
    endsQuiet: buffer[buffer.length - 1] === 0,
  }));

describe('the wait for the first piece', () => {
  it('holds audio until there is a buffer to hear', async () => {
    const {sink, chunks} = makeSink();
    const feed = openSpeechFeed({sink});
    chunk(feed, voiced(200));
    expect(chunks).toHaveLength(0);
    chunk(feed, voiced(200));
    expect(chunks).toHaveLength(0);
    chunk(feed, pause(120));
    expect(chunks).toHaveLength(1);
    const stats = await feed.close();
    // The buffer it waited for is what the first piece carries.
    expect(secondsOf(chunks[0])).toBeCloseTo(0.52, 6);
    expect(stats.jitterMs).toBe(520);
    expect(stats.firstPlayMs).toBe(416);
  });

  it('asks for more buffer the slower the engine is', async () => {
    const {sink, chunks} = makeSink();
    // A reply of 4 s said at 3x real time owes 8 s of work, so a bare 0.4 s in
    // hand would leave the ear waiting for the rest of it.
    const feed = openSpeechFeed({sink, text: 'x'.repeat(60)});
    chunk(feed, voiced(900), 3);
    chunk(feed, voiced(900), 3);
    chunk(feed, voiced(900), 3);
    // 2.7 s in hand is still short of the cap the wait is held to.
    expect(chunks).toHaveLength(0);
    chunk(feed, voiced(900), 3);
    expect(chunks).toHaveLength(1);
    const stats = await feed.close();
    expect(stats.rtf).toBeGreaterThan(2.5);
    expect(stats.jitterMs).toBe(3600);
    expect(DEFAULT_MAX_JITTER_SECONDS).toBe(3);
  });
});

describe('a reply paced at real time', () => {
  /** 3.66 s of talking, broken by three pauses. */
  const speak = async (sink: VoiceSink) => {
    const feed = openSpeechFeed({sink});
    chunk(feed, voiced(900));
    chunk(feed, pause(120));
    chunk(feed, voiced(1000));
    chunk(feed, pause(120));
    chunk(feed, voiced(800));
    chunk(feed, pause(120));
    chunk(feed, voiced(600));
    return feed.close();
  };

  it('plays every piece it cut, and no sample twice', async () => {
    const {sink, chunks} = makeSink();
    const stats = await speak(sink);
    const cut = pieces(chunks);
    expect(cut).toHaveLength(stats.segments);
    expect(cut.length).toBe(4);
    expect(cut.reduce((sum, piece) => sum + piece.seconds, 0)).toBeCloseTo(
      stats.seconds,
      6,
    );
    expect(stats.seconds).toBeCloseTo(3.66, 3);
    expect(stats.played).toBe(true);
  });

  it('cuts in a pause, never inside a word', async () => {
    const {sink, chunks} = makeSink();
    await speak(sink);
    const cut = pieces(chunks);
    // The last piece ends where the model stopped — it owes nobody a pause.
    expect(cut.slice(0, -1).every(piece => piece.endsQuiet)).toBe(true);
  });

  it('keeps every cut between the shortest piece and the cap', async () => {
    const {sink, chunks} = makeSink();
    await speak(sink);
    const cut = pieces(chunks);
    expect(
      cut.every(
        piece =>
          piece.seconds >= DEFAULT_JITTER_SECONDS - 1e-9 &&
          piece.seconds <= DEFAULT_MAX_SEGMENT_SECONDS + 1e-9,
      ),
    ).toBe(true);
    expect(cut.slice(1).every(piece => piece.seconds >= 0.5 - 1e-9)).toBe(true);
  });

  it('counts no dry spell when the engine kept ahead', async () => {
    const {sink} = makeSink();
    const stats = await speak(sink);
    expect(stats.underruns).toBe(0);
    expect(stats.forced).toBe(0);
    expect(stats.rebuffers).toBe(0);
    expect(stats.starveMs).toBe(0);
    expect(stats.rtf).toBeCloseTo(0.8, 2);
  });

  it('takes the numbers of the output it played through', async () => {
    const {sink} = makeSink({
      underruns: 2,
      nativeUnderruns: 2,
      dryMs: 400,
      gapMs: 400,
      gapMaxMs: 250,
      bridgeMs: 12,
    });
    const stats = await speak(sink);
    expect(stats.sinkMode).toBe('stream');
    expect(stats.nativeUnderruns).toBe(2);
    expect(stats.dryMs).toBe(400);
    expect(stats.gapMaxMs).toBe(250);
    expect(stats.bridgeMs).toBe(12);
    // The output's own count is added to the holes heard between two chunks.
    expect(stats.underruns).toBe(2);
  });
});

describe('a reply with no pause in it', () => {
  it('is broken up at the cap rather than held to the end', async () => {
    const {sink, chunks} = makeSink();
    const feed = openSpeechFeed({sink});
    for (let i = 0; i < 6; i++) {
      chunk(feed, voiced(1000));
    }
    const stats = await feed.close();
    const cut = pieces(chunks);
    expect(stats.forced).toBe(2);
    expect(
      cut.every(piece => piece.seconds <= DEFAULT_MAX_SEGMENT_SECONDS + 1e-9),
    ).toBe(true);
    expect(cut.reduce((sum, piece) => sum + piece.seconds, 0)).toBeCloseTo(
      6,
      6,
    );
    expect(stats.underruns).toBe(0);
    expect(stats.played).toBe(true);
  });
});

describe('where a piece is cut when the words are known', () => {
  /** 1.82 s: a pause at 0.46 s, one at 1.36 s, speech between and after. */
  const audio = () =>
    concat([voiced(400), pause(120), voiced(780), pause(120), voiced(400)]);

  it('prefers the quiet point the text says is a sentence end', async () => {
    const {sink, chunks} = makeSink();
    const feed = openSpeechFeed({sink, text: 'Alpha bravo charlie. delta'});
    feed.push(audio(), RATE);
    await feed.close();
    expect(pieces(chunks)[0].seconds).toBeCloseTo(1.36, 3);
  });

  it('takes the first pause it finds when it has no text to go by', async () => {
    const {sink, chunks} = makeSink();
    const feed = openSpeechFeed({sink});
    feed.push(audio(), RATE);
    await feed.close();
    expect(pieces(chunks)[0].seconds).toBeCloseTo(0.46, 3);
  });

  it('plans a boundary only where a piece could start', () => {
    // "3.5" is a number, not a sentence: a terminator counts only where the
    // next character starts a word.
    expect(planSpeechBoundaries('I am 3.5 years old. Thank you', 0.5)).toEqual([
      {at: 19 / 29, strong: true},
    ]);
    // The first stop is closer than the shortest piece the feed will play.
    expect(planSpeechBoundaries('Hi. There, again.', 0.5)).toEqual([
      {at: 10 / 17, strong: false},
    ]);
    // An ellipsis is one boundary and not three.
    expect(planSpeechBoundaries('Wait... then go on now please.', 0)).toEqual([
      {at: 7 / 30, strong: true},
    ]);
    expect(planSpeechBoundaries('', 0.5)).toEqual([]);
    expect(SPEECH_CHARS_PER_SECOND).toBe(15);
  });
});

describe('an output that goes dry', () => {
  it('pauses at the next boundary and rebuilds a bigger buffer', async () => {
    const {sink, chunks} = makeSink();
    const feed = openSpeechFeed({sink});
    chunk(feed, voiced(900));
    chunk(feed, pause(120));
    expect(chunks).toHaveLength(1);
    // The engine stalls for longer than the piece in the player can cover.
    advance(2000);
    chunk(feed, voiced(900), 0);
    expect(chunks).toHaveLength(1);
    chunk(feed, pause(120));
    // It cut at the pause it reached, then stopped to rebuild.
    expect(chunks).toHaveLength(2);
    chunk(feed, voiced(500));
    expect(chunks).toHaveLength(2);
    chunk(feed, voiced(900));
    chunk(feed, pause(120));
    const stats = await feed.close();
    // One hole heard, one deliberate pause taken at the boundary after it.
    expect(stats.underruns).toBeGreaterThanOrEqual(1);
    expect(stats.rebuffers).toBeGreaterThanOrEqual(1);
    expect(stats.starveMs).toBeGreaterThan(0);
    expect(stats.played).toBe(true);
  });
});

describe('a reply the model voice cannot finish in time', () => {
  const text = 'One two three four five six.';
  /** The first piece is heard, then the engine falls to 4x real time. */
  const fallBehind = (feed: SpeechFeed) => {
    chunk(feed, voiced(500), 0.5);
    chunk(feed, pause(100), 0.5);
    chunk(feed, voiced(500), 4);
    chunk(feed, voiced(500), 4);
    chunk(feed, voiced(500), 4);
  };

  it('offers the rest of the reply once, and says which rest', () => {
    const {sink} = makeSink();
    const feed = openSpeechFeed({sink, text, allowHandoff: true});
    fallBehind(feed);
    expect(feed.handoffOffered()).toBe(true);
    expect(feed.handoffOffered()).toBe(false);
    // Where the ear was left, on the only map there is: the reply read at a
    // steady pace. Six tenths of a second of a two-second sentence.
    expect(feed.remainingText()).toBe(text.slice(9));
  });

  it('says nothing about handing over when the setting is off', () => {
    const {sink} = makeSink();
    const feed = openSpeechFeed({sink, text});
    fallBehind(feed);
    expect(feed.handoffOffered()).toBe(false);
  });

  it('is not offered before the reply has been heard', () => {
    const {sink} = makeSink();
    const feed = openSpeechFeed({sink, text, allowHandoff: true});
    chunk(feed, voiced(900), 4);
    chunk(feed, voiced(900), 4);
    expect(feed.handoffOffered()).toBe(false);
  });
});

describe('a reply cut short', () => {
  it('stops the output and reports the reply unheard', async () => {
    const {sink, chunks} = makeSink();
    const feed = openSpeechFeed({sink});
    chunk(feed, voiced(900));
    chunk(feed, pause(120));
    expect(chunks).toHaveLength(1);
    feed.abort('barge-in');
    const stats = await feed.close();
    expect(sink.abort).toHaveBeenCalledWith('barge-in');
    // The output was already told to go silent; closing must not drain it again.
    expect(sink.end).not.toHaveBeenCalled();
    expect(stats.played).toBe(false);
    expect(stats.segments).toBe(1);
  });

  it('reports nothing heard when no audio had gone out', () => {
    const {sink, chunks} = makeSink();
    const feed = openSpeechFeed({sink});
    chunk(feed, voiced(100));
    feed.abort('js-bridge');
    expect(chunks).toHaveLength(0);
    expect(sink.abort).toHaveBeenCalledWith('js-bridge');
  });
});

describe('an output that refuses', () => {
  it('reports the refusal instead of claiming the reply was heard', async () => {
    const {sink} = makeSink({error: 'AudioTrack died'});
    const feed = openSpeechFeed({sink});
    chunk(feed, voiced(900));
    chunk(feed, pause(120));
    const stats = await feed.close();
    expect(stats.playError).toBe('AudioTrack died');
    expect(stats.played).toBe(false);
  });
});

describe('a push that is not a whole number of frames', () => {
  it('measures only samples that are there', async () => {
    const {sink, chunks} = makeSink();
    const feed = openSpeechFeed({sink});
    // 982 ms is not a number of 20 ms frames at this rate; the odd tail must
    // not be read as silence, which is what would put a cut inside it.
    feed.push(concat([voiced(851), pause(131)]), RATE);
    const stats = await feed.close();
    expect(pieces(chunks)).toHaveLength(1);
    expect(stats.forced).toBe(0);
    expect(pieces(chunks)[0].seconds).toBeCloseTo(0.982, 3);
  });
});

describe('a reply with nothing in it', () => {
  it('still plays the one frame it was given', async () => {
    const {sink, chunks} = makeSink();
    const feed = openSpeechFeed({sink});
    feed.push(voiced(20), RATE);
    const stats = await feed.close();
    expect(chunks).toHaveLength(1);
    expect(stats.segments).toBe(1);
    expect(stats.played).toBe(true);
  });

  it('is not a playback failure', async () => {
    const {sink} = makeSink();
    const stats = await openSpeechFeed({sink}).close();
    expect(sink.end).toHaveBeenCalled();
    expect(stats.played).toBe(false);
    expect(stats.segments).toBe(0);
  });
});

describe('the shortest piece', () => {
  it('is long enough to be a phrase', () => {
    expect(DEFAULT_MIN_SEGMENT_SECONDS).toBe(0.5);
    expect(DEFAULT_JITTER_SECONDS).toBe(0.4);
  });
});

describe('the first sentence of a reply still arriving', () => {
  /** The defaults, spelled out so a change to either is a decision. */
  const at = (text: string) =>
    firstSpokenSentence(text, {minSeconds: 1.2, maxSeconds: 14});

  it('is nothing until a terminator closes a sentence long enough to say', () => {
    expect(at('Yes.')).toBe('');
    expect(at('The park is quiet in the')).toBe('');
    expect(at('The park is quiet in the morning. Birds work.')).toBe(
      'The park is quiet in the morning.',
    );
  });

  it('waits for a sentence rather than handing over half a phrase', () => {
    // A comma is where the speaker breathed, not where they ended. Saying this
    // and then repeating it whole is worse than the wait.
    expect(at('the garden needs water, and it is open all day')).toBe('');
  });

  it('takes a breath when a reply is too long to have no punctuation', () => {
    const long = 'the garden needs water, '.repeat(12);
    expect(long.length).toBeGreaterThan(210);
    // The cut ends at the mark: the space after it belongs to the words that
    // follow, and both callers trim what they are handed.
    expect(at(long)).toBe('the garden needs water,');
  });

  it('will not call the point in a number the end of a sentence', () => {
    // "3." is only a full stop if nothing is coming after it, and a reply that
    // is still arriving always has something coming after it.
    expect(at('Turn at the marker on the road past 3.')).toBe('');
  });

  it('agrees with the feed about what a sentence end is', () => {
    const text =
      'The park is quiet. A few birds work along the fence. The gate stays open.';
    const strong = planSpeechBoundaries(
      text,
      DEFAULT_MIN_SEGMENT_SECONDS,
    ).filter(mark => mark.strong);
    expect(strong.length).toBeGreaterThan(1);
    // The same mark, not merely the same kind of mark: where the fast start
    // stops is the first place the feed would have stopped too.
    expect(at(text)).toBe(
      text.slice(0, Math.round(strong[0]!.at * text.length)),
    );
    expect(at(text)).toBe('The park is quiet.');
  });
});

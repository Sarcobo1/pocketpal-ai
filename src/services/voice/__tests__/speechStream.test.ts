import {neuralAudioPlayer} from '@pocketpalai/react-native-speech/engine-sdk';

import {
  DEFAULT_JITTER_SECONDS,
  DEFAULT_MAX_SEGMENT_SECONDS,
  openSpeechFeed,
} from '../speechStream';

/**
 * The device player takes one buffer and plays it to the end, so a streamed
 * reply is only as good as where its pieces are cut. These tests are about
 * exactly that: nothing plays before there is a buffer, a cut falls in a pause
 * rather than in a vowel, a reply with no pause is still broken up, and what is
 * left at the end is still heard.
 */

const RATE = 24000;
const SAMPLES = (ms: number) => Math.round((RATE * ms) / 1000);
/** Above the quiet floor: a loud enough frame is speech for these purposes. */
const voiced = (ms: number) => new Float32Array(SAMPLES(ms)).fill(0.3);
/** Digital silence, which is what a pause is made of here. */
const pause = (ms: number) => new Float32Array(SAMPLES(ms));
const secondsOf = (buffer: Float32Array) => buffer.length / RATE;

const play = neuralAudioPlayer.play as jest.Mock;
const stop = neuralAudioPlayer.stop as jest.Mock;

/** Seconds of audio the player was handed, in the order it heard them. */
const played = () =>
  play.mock.calls.map(call => ({
    seconds: secondsOf(call[0].samples),
    endsQuiet: call[0].samples[call[0].samples.length - 1] === 0,
    duration: call[0].duration,
  }));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('a streamed reply with pauses in it', () => {
  /** 3.6 s of talking, broken by three pauses. */
  const speak = async (feed: ReturnType<typeof openSpeechFeed>) => {
    feed.push(voiced(900), RATE);
    feed.push(pause(120), RATE);
    feed.push(voiced(1000), RATE);
    feed.push(pause(120), RATE);
    feed.push(voiced(800), RATE);
    feed.push(pause(120), RATE);
    feed.push(voiced(600), RATE);
    return feed.close();
  };

  it('holds the first piece until there is a jitter buffer to hear', async () => {
    const feed = openSpeechFeed();
    feed.push(voiced(500), RATE);
    expect(play).not.toHaveBeenCalled();
    feed.push(pause(120), RATE);
    expect(play).not.toHaveBeenCalled();
    feed.push(voiced(500), RATE);
    expect(play).not.toHaveBeenCalled();
    await feed.close();
  });

  it('plays every piece it cut, and no sample twice', async () => {
    const stats = await speak(openSpeechFeed());
    const pieces = played();
    expect(pieces.length).toBe(stats.segments);
    expect(pieces.length).toBeGreaterThan(1);
    const total = pieces.reduce((sum, piece) => sum + piece.seconds, 0);
    expect(total).toBeCloseTo(stats.seconds, 6);
    expect(stats.played).toBe(true);
  });

  it('cuts at a pause, not inside a word', async () => {
    await speak(openSpeechFeed());
    const pieces = played();
    // The last piece is the tail of the reply, which ends where the model
    // stopped — it owes nobody a pause.
    expect(pieces.slice(0, -1).every(piece => piece.endsQuiet)).toBe(true);
  });

  it('keeps every cut inside the buffer and the cap', async () => {
    await speak(openSpeechFeed());
    const pieces = played().slice(0, -1);
    expect(
      pieces.every(piece => piece.seconds >= DEFAULT_JITTER_SECONDS - 1e-9),
    ).toBe(true);
    expect(
      pieces.every(
        piece => piece.seconds <= DEFAULT_MAX_SEGMENT_SECONDS + 1e-9,
      ),
    ).toBe(true);
  });

  it('tells the player how long each piece is', async () => {
    await speak(openSpeechFeed());
    expect(played().every(piece => piece.duration === piece.seconds)).toBe(
      true,
    );
  });

  it('counts nothing as a dry spell when the engine kept ahead', async () => {
    const stats = await speak(openSpeechFeed());
    expect(stats.underruns).toBe(0);
    expect(stats.forced).toBe(0);
  });
});

describe('a reply with no pause in it', () => {
  it('is broken up at the cap rather than held to the end', async () => {
    const feed = openSpeechFeed();
    for (let i = 0; i < 6; i++) {
      feed.push(voiced(1000), RATE);
    }
    const stats = await feed.close();
    const pieces = played();
    expect(stats.forced).toBeGreaterThanOrEqual(2);
    expect(
      pieces.every(
        piece => piece.seconds <= DEFAULT_MAX_SEGMENT_SECONDS + 1e-9,
      ),
    ).toBe(true);
    expect(pieces.reduce((sum, piece) => sum + piece.seconds, 0)).toBeCloseTo(
      6,
      6,
    );
    expect(stats.played).toBe(true);
  });
});

describe('the tail of a reply', () => {
  it('plays even when it is shorter than the buffer', async () => {
    const feed = openSpeechFeed();
    feed.push(voiced(400), RATE);
    const stats = await feed.close();
    expect(played()).toHaveLength(1);
    expect(played()[0].seconds).toBeCloseTo(0.4, 6);
    expect(stats.played).toBe(true);
  });

  it('is not lost when the reply is one frame long', async () => {
    const feed = openSpeechFeed();
    feed.push(voiced(20), RATE);
    await feed.close();
    expect(played()).toHaveLength(1);
  });
});

describe('a player that goes hungry', () => {
  it('counts the dry spell the user hears', async () => {
    const feed = openSpeechFeed();
    feed.push(voiced(900), RATE);
    feed.push(pause(120), RATE);
    // Everything queued has played out and the engine has not produced more.
    await new Promise(resolve => setImmediate(resolve));
    feed.push(voiced(900), RATE);
    feed.push(pause(120), RATE);
    const stats = await feed.close();
    expect(stats.underruns).toBeGreaterThanOrEqual(1);
    expect(stats.played).toBe(true);
  });
});

describe('a reply cut short', () => {
  it('drops what was not heard and stops the player', async () => {
    const feed = openSpeechFeed();
    feed.push(voiced(900), RATE);
    feed.push(pause(120), RATE);
    // Let the first piece reach the ear, so there is something to interrupt.
    await new Promise(resolve => setImmediate(resolve));
    feed.push(voiced(2000), RATE);
    feed.push(pause(120), RATE);
    feed.abort('barge-in');
    const stats = await feed.close();
    expect(stats.played).toBe(false);
    expect(stop).toHaveBeenCalled();
    // Only the piece already on its way to the ear could still be played.
    expect(played().length).toBeLessThanOrEqual(1);
  });

  it('leaves other audio alone when nothing had started', async () => {
    const feed = openSpeechFeed();
    feed.push(voiced(100), RATE);
    feed.abort('js-bridge');
    const stats = await feed.close();
    expect(stop).not.toHaveBeenCalled();
    expect(stats.played).toBe(false);
    expect(play).not.toHaveBeenCalled();
  });
});

describe('a player that refuses', () => {
  it('reports the refusal instead of claiming the reply was heard', async () => {
    play.mockRejectedValueOnce(new Error('AudioTrack died'));
    const feed = openSpeechFeed();
    feed.push(voiced(900), RATE);
    feed.push(pause(120), RATE);
    const stats = await feed.close();
    expect(stats.playError).toBe('AudioTrack died');
    expect(stats.played).toBe(false);
  });
});

describe('pushes that are not whole frames', () => {
  it('measures only samples that are there', async () => {
    const feed = openSpeechFeed();
    // 851 ms is not a number of 20 ms frames at any rate; the odd tail must not
    // be read as silence, which is what would put a cut in the middle of it.
    feed.push(voiced(851), RATE);
    feed.push(pause(131), RATE);
    const stats = await feed.close();
    const pieces = played();
    expect(pieces).toHaveLength(1);
    expect(stats.forced).toBe(0);
    expect(pieces[0].seconds).toBeCloseTo((851 + 131) / 1000, 3);
  });
});

describe('the numbers a device run is read against', () => {
  it('says when the first sample reached the player', async () => {
    const feed = openSpeechFeed();
    feed.push(voiced(900), RATE);
    feed.push(pause(120), RATE);
    const stats = await feed.close();
    // `speech.stream` prints this as `firstMs`; the log itself is silent under
    // jest, so the number it would have carried is what is checked here.
    expect(stats.firstPlayMs).toBeGreaterThanOrEqual(0);
    expect(stats.seconds).toBeCloseTo(1.02, 3);
  });
});

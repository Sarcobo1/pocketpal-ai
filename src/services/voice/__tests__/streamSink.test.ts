import {neuralAudioPlayer} from '@pocketpalai/react-native-speech/engine-sdk';

import NativeSpeechStream from '../../../specs/NativeSpeechStream';
import {openVoiceSink} from '../streamSink';

/**
 * Two ways to hear a streamed reply, and the difference between them is the
 * whole reason this file exists: a piece per player call costs the device a new
 * audio track and a fresh claim on the audio focus every time, and that cost is
 * a hole in the middle of a sentence. These tests measure the hole on the
 * pieces path and prove the stream path never makes one — one open stream,
 * chunks appended to it in order, and the device's own count of the time it
 * spent hungry.
 */

jest.mock('../../../specs/NativeSpeechStream', () => ({
  __esModule: true,
  default: {
    begin: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    abort: jest.fn(),
  },
}));

const native = NativeSpeechStream as unknown as {
  begin: jest.Mock;
  write: jest.Mock;
  end: jest.Mock;
  abort: jest.Mock;
};

const play = neuralAudioPlayer.play as jest.Mock;
const stop = neuralAudioPlayer.stop as jest.Mock;

const RATE = 24000;
const SAMPLES = (ms: number) => Math.round((RATE * ms) / 1000);
const voiced = (ms: number) => new Float32Array(SAMPLES(ms)).fill(0.3);
const seconds = (buffer: Float32Array) => buffer.length / RATE;

/** Whatever the bridge was handed, read back as the samples it carried. */
const pcmOf = (base64: string): Int16Array => {
  const bytes = Buffer.from(base64, 'base64');
  return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
};

const nativeStats = (over = {}) => ({
  underruns: 0,
  dryMs: 0,
  framesWritten: 0,
  framesPlayed: 0,
  leadMs: 0,
  ...over,
});

/** Every promise the current task set up has had its turn. */
const settle = () => new Promise(resolve => setImmediate(resolve));

let now = 0;
beforeEach(() => {
  now = 1_700_000_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  play.mockReset().mockResolvedValue(undefined);
  stop.mockReset().mockResolvedValue(undefined);
  native.begin.mockReset().mockResolvedValue(true);
  native.write.mockReset().mockResolvedValue(true);
  native.end.mockReset().mockResolvedValue(nativeStats());
  native.abort.mockReset().mockResolvedValue(true);
});
afterEach(() => {
  jest.restoreAllMocks();
});

const advance = (ms: number) => {
  now += ms;
};

describe('a device that takes a continuous stream', () => {
  it('opens one stream for the reply and appends every chunk to it', async () => {
    const sink = openVoiceSink({allowStream: true});
    sink.write(voiced(500), RATE);
    await settle();
    sink.write(voiced(600), RATE);
    sink.write(voiced(400), RATE);
    const stats = await sink.end();
    // One claim on the audio focus for the reply, not one per piece.
    expect(native.begin).toHaveBeenCalledTimes(1);
    expect(native.begin).toHaveBeenCalledWith(RATE, 1, true);
    expect(native.write).toHaveBeenCalledTimes(3);
    expect(stats.mode).toBe('stream');
    expect(stats.segments).toBe(3);
    expect(play).not.toHaveBeenCalled();
  });

  it('hands over the samples it was given, clipped to the range', async () => {
    const sink = openVoiceSink({allowStream: true});
    sink.write(new Float32Array([0, 1, -1, 0.5, 2, -2]), RATE);
    await sink.end();
    expect(Array.from(pcmOf(native.write.mock.calls[0][0]))).toEqual([
      0, 32767, -32768, 16383, 32767, -32768,
    ]);
  });

  it('never lets a chunk overtake the one before it', async () => {
    const events: string[] = [];
    const gates: Array<(ok: boolean) => void> = [];
    native.write.mockImplementation((base64: string) => {
      events.push(`call:${pcmOf(base64).length}`);
      return new Promise<boolean>(resolve => {
        gates.push(() => {
          events.push('done');
          resolve(true);
        });
      });
    });
    const sink = openVoiceSink({allowStream: true});
    sink.write(voiced(300), RATE);
    sink.write(voiced(200), RATE);
    await settle();
    // The second waits for the first to be taken, though both were ready.
    expect(events).toEqual([`call:${SAMPLES(300)}`]);
    gates[0](true);
    await settle();
    expect(events[2]).toBe(`call:${SAMPLES(200)}`);
    gates[1](true);
    const stats = await sink.end();
    expect(stats.segments).toBe(2);
    expect(events).toEqual([
      `call:${SAMPLES(300)}`,
      'done',
      `call:${SAMPLES(200)}`,
      'done',
    ]);
  });

  it('takes the dry time of the stream as the gap the ear heard', async () => {
    const sink = openVoiceSink({allowStream: true});
    sink.write(voiced(900), RATE);
    native.end.mockResolvedValue(nativeStats({underruns: 2, dryMs: 400}));
    const stats = await sink.end();
    expect(stats.dryMs).toBe(400);
    expect(stats.gapMs).toBe(400);
    expect(stats.gapMaxMs).toBe(0);
    expect(stats.nativeUnderruns).toBe(2);
    expect(stats.underruns).toBe(2);
  });

  it('reports the audio the stream refused to take', async () => {
    const sink = openVoiceSink({allowStream: true});
    native.write.mockResolvedValueOnce(true).mockResolvedValue(false);
    sink.write(voiced(500), RATE);
    sink.write(voiced(500), RATE);
    sink.write(voiced(500), RATE);
    const stats = await sink.end();
    expect(stats.error).toBe('stream-closed');
    expect(stats.segments).toBe(1);
    expect(native.write).toHaveBeenCalledTimes(2);
  });

  it('silences the stream on a barge-in and leaves no stream open', async () => {
    const sink = openVoiceSink({allowStream: true});
    sink.write(voiced(500), RATE);
    await settle();
    sink.abort('barge-in');
    await settle();
    const stats = await sink.end();
    expect(native.abort).toHaveBeenCalledTimes(1);
    expect(stats.error).toBe('barge-in');
    expect(play).not.toHaveBeenCalled();
  });

  it('never opens a stream it has no audio for', async () => {
    const sink = openVoiceSink({allowStream: true});
    sink.abort('js-bridge');
    const stats = await sink.end();
    expect(native.begin).not.toHaveBeenCalled();
    expect(native.abort).not.toHaveBeenCalled();
    expect(stats.error).toBe('');
  });
});

describe('a device that will not take one', () => {
  it('plays the reply piece by piece instead', async () => {
    native.begin.mockResolvedValue(false);
    const sink = openVoiceSink({allowStream: true});
    sink.write(voiced(500), RATE);
    sink.write(voiced(600), RATE);
    const stats = await sink.end();
    expect(native.write).not.toHaveBeenCalled();
    expect(play).toHaveBeenCalledTimes(2);
    expect(stats.mode).toBe('pieces');
    expect(stats.segments).toBe(2);
  });

  it('measures what each piece boundary costs the ear', async () => {
    native.begin.mockResolvedValue(false);
    // The player answers when the clip is over, plus 300 ms of track teardown,
    // reallocation and focus on every single one of them.
    play.mockImplementation(async (request: {samples: Float32Array}) => {
      advance(seconds(request.samples) * 1000 + 300);
    });
    const sink = openVoiceSink({allowStream: true});
    sink.write(voiced(500), RATE);
    sink.write(voiced(600), RATE);
    const stats = await sink.end();
    expect(stats.gapMs).toBe(600);
    expect(stats.gapMaxMs).toBe(300);
    expect(stats.underruns).toBe(2);
    // Not one of those milliseconds is the engine being slow: it is the output.
    expect(stats.dryMs).toBe(0);
  });

  it('counts a refusal it cannot recover from', async () => {
    native.begin.mockResolvedValue(false);
    play.mockRejectedValueOnce(new Error('AudioTrack died'));
    const sink = openVoiceSink({allowStream: true});
    sink.write(voiced(500), RATE);
    sink.write(voiced(600), RATE);
    const stats = await sink.end();
    expect(stats.error).toBe('AudioTrack died');
    expect(stats.segments).toBe(0);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('stops only the audio it was the one playing', async () => {
    native.begin.mockResolvedValue(false);
    const sink = openVoiceSink({allowStream: true});
    sink.abort('barge-in');
    await sink.end();
    expect(stop).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });

  it('stops the player when the reply was already being heard', async () => {
    native.begin.mockResolvedValue(false);
    let release: () => void = () => {};
    play.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          release = resolve;
        }),
    );
    const sink = openVoiceSink({allowStream: true});
    sink.write(voiced(500), RATE);
    await settle();
    expect(play).toHaveBeenCalledTimes(1);
    sink.abort('barge-in');
    expect(stop).toHaveBeenCalledTimes(1);
    release();
    const stats = await sink.end();
    expect(stats.error).toBe('barge-in');
  });
});

describe('what the reply cost to sound', () => {
  it('reads the device clock against the samples it was handed', async () => {
    // The device says it played 1500 ms of frames and spent 1500 ms doing it:
    // the clip sounded exactly as long as it was made, which is ratio 1.
    native.end.mockResolvedValue(
      nativeStats({wallMs: 1500, framesWritten: SAMPLES(1500)}),
    );
    const sink = openVoiceSink({allowStream: true});
    sink.write(voiced(500), RATE);
    sink.write(voiced(600), RATE);
    sink.write(voiced(400), RATE);
    const stats = await sink.end();
    expect(stats.sampleRate).toBe(RATE);
    expect(stats.audioMs).toBe(1500);
    expect(stats.writtenMs).toBe(1500);
    expect(stats.playedMs).toBe(1500);
    expect(stats.rateMismatch).toBe(0);
  });

  it('counts audio the track never took as a loss', async () => {
    // 1500 ms handed over, 1400 ms accepted: the last piece was torn, and the
    // ratio alone would not say which side of the bridge lost it.
    native.end.mockResolvedValue(
      nativeStats({wallMs: 1400, framesWritten: SAMPLES(1400)}),
    );
    const sink = openVoiceSink({allowStream: true});
    sink.write(voiced(500), RATE);
    sink.write(voiced(600), RATE);
    sink.write(voiced(400), RATE);
    const stats = await sink.end();
    expect(stats.audioMs).toBe(1500);
    expect(stats.writtenMs).toBe(1400);
  });

  it('plays a stretch of wall time for the audio it was given', async () => {
    // The device's own clock says 1800 ms for 1500 ms of samples: the reply was
    // heard slow. Whether the clip was made that long or the output played it
    // that way is what `writtenMs` and the engine's frame count then settle.
    native.end.mockResolvedValue(
      nativeStats({wallMs: 1800, framesWritten: SAMPLES(1500)}),
    );
    const sink = openVoiceSink({allowStream: true});
    sink.write(voiced(500), RATE);
    sink.write(voiced(600), RATE);
    sink.write(voiced(400), RATE);
    const stats = await sink.end();
    expect(stats.playedMs / stats.audioMs).toBeCloseTo(1.2, 5);
  });

  it('counts a chunk that arrived at another rate than the stream opened at', async () => {
    const sink = openVoiceSink({allowStream: true});
    sink.write(voiced(500), RATE);
    await settle();
    sink.write(new Float32Array(SAMPLES(500)).fill(0.3), 16000);
    const stats = await sink.end();
    // One stream, one rate: the second chunk is heard at the first one, which is
    // the pitch change this number exists to catch.
    expect(stats.sampleRate).toBe(RATE);
    expect(stats.rateMismatch).toBe(1);
  });

  it('measures the player calls of a piece-by-piece reply', async () => {
    native.begin.mockResolvedValue(false);
    play.mockImplementation(async (request: {samples: Float32Array}) => {
      advance(seconds(request.samples) * 1000 + 300);
    });
    const sink = openVoiceSink({allowStream: true});
    sink.write(voiced(500), RATE);
    sink.write(voiced(600), RATE);
    const stats = await sink.end();
    expect(stats.audioMs).toBe(1100);
    // Each call is its own clip plus the 300 ms it took to rebuild the output.
    expect(stats.playedMs).toBe(1700);
    expect(stats.sampleRate).toBe(RATE);
  });

  it('counts a piece made at another rate on the path that opens a player per piece', async () => {
    native.begin.mockResolvedValue(false);
    const sink = openVoiceSink({allowStream: true});
    sink.write(voiced(500), RATE);
    sink.write(new Float32Array(SAMPLES(500)).fill(0.3), 16000);
    const stats = await sink.end();
    expect(stats.sampleRate).toBe(RATE);
    expect(stats.rateMismatch).toBe(1);
  });
});

describe('a platform that was not built with the stream module', () => {
  it('does not ask for one', async () => {
    native.begin.mockResolvedValue(true);
    const sink = openVoiceSink({allowStream: false});
    sink.write(voiced(500), RATE);
    const stats = await sink.end();
    expect(native.begin).not.toHaveBeenCalled();
    expect(play).toHaveBeenCalledTimes(1);
    expect(stats.mode).toBe('pieces');
  });
});

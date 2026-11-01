import {ASR_CHUNK_BYTES} from '../../asr/constants';
import {chatSessionStore} from '../../../store';

import {OmniVoiceEngine} from '../omniEngine';
import type {VoiceTurnEvents, VoiceTurnPayload} from '../types';

const chat = chatSessionStore as any;

const speech = (ms: number, amplitude = 0.1): Uint8Array => {
  const bytes = (ms / 50) * ASR_CHUNK_BYTES;
  const pcm = new Uint8Array(bytes);
  const view = new DataView(pcm.buffer);
  for (let i = 0; i < bytes / 2; i++) {
    view.setInt16(i * 2, (i % 2 ? 1 : -1) * amplitude * 0x7fff, true);
  }
  return pcm;
};

const flush = () => new Promise(resolve => setImmediate(resolve));

function makePort() {
  const port = {
    onTurn: null as ((id: string) => void) | null,
    settle: () => {},
    send: jest.fn(),
    stop: jest.fn(),
  };
  port.send.mockImplementation(
    (_payload: VoiceTurnPayload, onTurn: (id: string) => void) => {
      port.onTurn = onTurn;
      return new Promise<void>(resolve => {
        port.settle = resolve;
      });
    },
  );
  return port;
}

const events = (): jest.Mocked<VoiceTurnEvents> => ({
  transcribed: jest.fn(),
  speechStarted: jest.fn(),
});

describe('OmniVoiceEngine', () => {
  const engine = new OmniVoiceEngine();
  let savedSessions: unknown;

  beforeEach(() => {
    savedSessions = chat.sessions;
  });

  afterEach(() => {
    chat.sessions = savedSessions;
    jest.clearAllMocks();
  });

  it('sends the utterance as a WAV, with no transcript', async () => {
    const port = makePort();
    const on = events();
    const turn = engine.runTurn(speech(500), port, on);

    await flush();

    expect(on.transcribed).toHaveBeenCalledWith('');
    const payload = port.send.mock.calls[0][0] as VoiceTurnPayload;
    expect(payload.text).toBe('');
    expect(payload.audioUri).toMatch(/\/voice-audio\/utt-\d+\.wav$/);

    chat.sessions = [
      {
        id: 'session-1',
        messages: [
          {id: 'turn-1', type: 'assistant_turn', steps: [], metadata: {}},
        ],
      },
    ];
    port.onTurn!('turn-1');
    port.settle();

    await expect(turn.done).resolves.toBe('answered');
  });

  it('sends nothing for audio the VAD rejects', async () => {
    const port = makePort();
    const turn = engine.runTurn(speech(500, 0.001), port, events());

    await expect(turn.done).resolves.toBe('empty');
    expect(port.send).not.toHaveBeenCalled();
  });

  it('stops the reply on interrupt and reports the turn as interrupted', async () => {
    const port = makePort();
    const turn = engine.runTurn(speech(500), port, events());

    await flush();
    const interrupted = turn.interrupt();
    expect(port.stop).toHaveBeenCalledTimes(1);
    port.settle();
    await interrupted;

    await expect(turn.done).resolves.toBe('interrupted');
  });

  it('reports a reply that never lands', async () => {
    const port = makePort();
    port.send.mockImplementationOnce(
      async (_payload: VoiceTurnPayload, onTurn: (id: string) => void) => {
        onTurn('turn-1');
        throw new Error('boom');
      },
    );
    const turn = engine.runTurn(speech(500), port, events());

    await expect(turn.done).resolves.toBe('reply_failed');
  });
});

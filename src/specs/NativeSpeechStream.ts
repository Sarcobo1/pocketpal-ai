import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

/**
 * What one continuous playback stream cost to run, read when it is over.
 *
 * These are the numbers a choppy reply is diagnosed with: `dryMs` is the wall
 * time the output device had nothing queued, which is the gap a listener hears,
 * and `underruns` counts how many times the buffer actually ran out.
 */
export interface SpeechStreamStats {
  /** Times the track ran out of queued audio; -1 when the OS cannot say. */
  underruns: number;
  /** Milliseconds the track was playing with an empty queue. */
  dryMs: number;
  /** Samples handed to the track, all channels counted. */
  framesWritten: number;
  /** Samples the track had reached when it stopped. */
  framesPlayed: number;
  /** Milliseconds the open track waited for its first chunk before starting. */
  leadMs: number;
}

/**
 * One uninterrupted PCM stream for one spoken reply.
 *
 * The system player takes a whole clip per call and rebuilds its output path
 * every time, so a reply delivered in pieces is heard as piece, silence, piece.
 * This module keeps a single open stream for the whole reply and appends to it.
 * Android only; other platforms resolve nothing and callers fall back.
 */
export interface Spec extends TurboModule {
  /** Open the stream. Resolves false when the device refused the track. */
  begin(
    sampleRate: number,
    channels: number,
    ducking: boolean,
  ): Promise<boolean>;
  /** Append base64-encoded little-endian int16 PCM. Returns false once closed. */
  write(base64Pcm16: string): Promise<boolean>;
  /** Close the stream and resolve with its cost once the tail has been played. */
  end(): Promise<SpeechStreamStats>;
  /** Stop at once, drop what is queued, and release the stream. */
  abort(): Promise<boolean>;
}

// `get`, not `getEnforcing`: iOS and any build without the module must keep
// speaking through the per-piece player instead of throwing at import time.
const NativeSpeechStream: Spec | null =
  TurboModuleRegistry.get<Spec>('SpeechStreamModule');

export default NativeSpeechStream;

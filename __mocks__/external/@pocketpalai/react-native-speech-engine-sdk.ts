/**
 * Jest mock for the `engine-sdk` subpath of `@pocketpalai/react-native-speech`.
 *
 * The real module pulls in the package's TurboModule bindings, which Jest
 * cannot load. Only the PCM sink the model's own voice plays through is
 * exposed here, as jest-tracked functions so a test can assert on the buffer
 * handed to the player.
 */
export const neuralAudioPlayer = {
  play: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  pause: jest.fn().mockResolvedValue(false),
  resume: jest.fn().mockResolvedValue(false),
  isSpeaking: jest.fn().mockResolvedValue(false),
};

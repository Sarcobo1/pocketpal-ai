// Projector (mmproj) filename pattern. Kept in a dependency-free module so the
// pure device-rules parser can share it without pulling in the store/UI/RN layer
// that multimodalHelpers transitively depends on.
export const MMProjRegex = /[-_.]*mmproj[-_.].+\.gguf$/i;

/**
 * llama.rn reads media as a local path. It strips `file://` from an image url
 * and from an audio url, but pushes audio `data` through untouched, so one
 * rule applied by the caller keeps either field usable. Lives here for the same
 * dependency-free reason as the regex above.
 */
export const toLocalMediaPath = (uri: string): string =>
  uri.startsWith('file://') ? uri.slice('file://'.length) : uri;

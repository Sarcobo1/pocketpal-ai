// LLAMARN-DEP: native throw wording, checked by scripts/__tests__/llamarn-error-strings.test.ts.
export const LLAMARN_ERROR_PATTERNS = {
  contextFull: /context is full/i,
  speculativeInit: /failed to create draft context/i,
  toolArgsParse: /Failed to parse tool call arguments as JSON/i,
  // The context's one claim was taken by something else — a completion that
  // started while the previous reply was still being voiced is the usual way.
  // Transient by nature, so it is never written into the chat as a reply.
  contextBusy: /Context is busy/i,
};

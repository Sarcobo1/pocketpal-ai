/**
 * Error classes for better error handling throughout the application
 */

import axios from 'axios';
import {uiStore} from '../store/UIStore';
import type {RouterFailure} from '../store/routerVerdicts';
/**
 * NetworkError - Used for connectivity-related errors
 * Examples: No internet connection, timeout, etc.
 */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * AppCheckError - Used for Firebase App Check verification errors
 * Examples: App not installed from official store, verification failed, etc.
 */
export class AppCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppCheckError';
  }
}

/**
 * The router load a remote model needed was withdrawn by the user's own
 * action: a cancel, or an edit or removal of its server. A type of its own so
 * a surface can stay silent: the user knows why it ended.
 */
export class RemoteModelRequestWithdrawnError extends Error {
  constructor() {
    super('Remote model request withdrawn');
    this.name = 'RemoteModelRequestWithdrawnError';
  }
}

/**
 * The remote model never became ready. `serverMessage` holds only the
 * server's own bounded words, so a surface can set them apart from the app's
 * sentence for the cause.
 */
export class RemoteModelNotReadyError extends Error {
  readonly cause: RouterFailure['cause'];
  readonly serverMessage?: string;

  constructor(cause: RouterFailure['cause'], serverMessage?: string) {
    super(`Remote model not ready: ${cause}`);
    this.name = 'RemoteModelNotReadyError';
    this.cause = cause;
    this.serverMessage = serverMessage;
  }
}

/** A non-2xx answer to a remote request, with the server's own message. */
export class RemoteHttpError extends Error {
  readonly status: number;
  readonly serverMessage?: string;

  constructor(message: string, status: number, serverMessage?: string) {
    super(message);
    this.name = 'RemoteHttpError';
    this.status = status;
    this.serverMessage = serverMessage;
  }
}

/**
 * ServerError - Used for backend server errors
 * Examples: 500 errors, API unavailable, etc.
 */
export class ServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServerError';
  }
}

/**
 * Standardized error state interface for consistent error handling across the app
 */
export interface ErrorState {
  code:
    | 'authentication'
    | 'authorization'
    | 'network'
    | 'storage'
    | 'server'
    | 'multimodal'
    | 'memory'
    | 'unknown';
  service?: 'huggingface' | 'firebase' | 'localapi';
  message: string;
  context: 'search' | 'download' | 'modelDetails' | 'chat' | 'modelInit';
  recoverable: boolean;
  severity?: 'error' | 'warning';
  metadata?: {
    modelId?: string;
    [key: string]: any;
  };
}

/**
 * Memory failures reach JavaScript as whatever the native layer said, so the
 * only signal is its wording. These are the phrases llama.cpp, ggml and the
 * allocator actually produce; `\boom\b` deliberately keeps "room" out of it.
 */
const MEMORY_PATTERNS =
  /(out of memory|not enough memory|insufficient memory|cannot allocate|could not allocate|unable to allocate|memory allocation failed|std::bad_alloc|bad_alloc|\boom\b|outofmemory|unable to lock|failed to (mlock|migrate)|mmap.*(fail|error)|ggml.*(alloc|buffer).*(fail|error))/i;

/**
 * True when the error is about memory rather than about the model file, the
 * template or the device. Drives both the message the user sees and the
 * one retry from backing store in ModelStore.
 */
export function isMemoryError(error: unknown): boolean {
  if (typeof error === 'string') {
    return MEMORY_PATTERNS.test(error);
  }
  if (error && typeof error === 'object') {
    const candidate = error as {
      message?: unknown;
      name?: unknown;
      code?: unknown;
    };
    return [candidate.message, candidate.name, candidate.code].some(
      value => typeof value === 'string' && MEMORY_PATTERNS.test(value),
    );
  }
  return false;
}

/**
 * Helper function to create a standardized error state from any error
 */
export function createErrorState(
  error: unknown,
  context: ErrorState['context'],
  service?: ErrorState['service'],
  metadata?: ErrorState['metadata'],
  severity: ErrorState['severity'] = 'error',
): ErrorState {
  const l10nObject = uiStore.l10n;
  let code: ErrorState['code'] = 'unknown';
  let message = l10nObject.errors.unexpectedError;
  let recoverable = true;
  let errorService = service;

  if (axios.isAxiosError(error)) {
    const statusCode = error.response?.status;

    // Check URL to determine service if not explicitly provided
    if (!errorService) {
      const url = error.config?.url || '';
      if (url.includes('huggingface.co') || url.includes('hf.co')) {
        errorService = 'huggingface';
      }
    }

    if (statusCode === 401) {
      code = 'authentication';
      message =
        errorService === 'huggingface'
          ? context === 'search'
            ? l10nObject.errors.hfAuthenticationErrorSearch
            : l10nObject.errors.hfAuthenticationError
          : l10nObject.errors.authenticationError;
    } else if (statusCode === 403) {
      code = 'authorization';
      message =
        errorService === 'huggingface'
          ? l10nObject.errors.hfAuthorizationError
          : l10nObject.errors.authorizationError;
    } else if (statusCode && statusCode >= 500) {
      code = 'server';
      message =
        errorService === 'huggingface'
          ? l10nObject.errors.hfServerError
          : l10nObject.errors.serverError;
    } else if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      code = 'network';
      message =
        errorService === 'huggingface'
          ? l10nObject.errors.hfNetworkTimeout
          : l10nObject.errors.networkTimeout;
    } else if (error.code === 'ERR_NETWORK') {
      code = 'network';
      message =
        errorService === 'huggingface'
          ? l10nObject.errors.hfNetworkError
          : l10nObject.errors.networkError;
    }
  } else if (error instanceof NetworkError) {
    code = 'network';
    message = error.message;
  } else if (error instanceof ServerError) {
    code = 'server';
    message = error.message;
  } else if (error instanceof Error) {
    // Handle error messages containing HTTP status codes (e.g., 'Client error: 403')
    if (typeof error.message === 'string') {
      const statusCodeMatch = error.message.match(
        /(?:Client error:|status:?)\s*(\d{3})/i,
      );
      if (statusCodeMatch) {
        const statusCode = parseInt(statusCodeMatch[1], 10);

        if (statusCode === 401) {
          code = 'authentication';
          message =
            errorService === 'huggingface'
              ? l10nObject.errors.hfAuthenticationError
              : l10nObject.errors.authenticationError;
        } else if (statusCode === 403) {
          code = 'authorization';
          message =
            errorService === 'huggingface'
              ? l10nObject.errors.hfAuthorizationError
              : l10nObject.errors.authorizationError;
        } else if (statusCode >= 500) {
          code = 'server';
          message =
            errorService === 'huggingface'
              ? l10nObject.errors.hfServerError
              : l10nObject.errors.serverError;
        } else {
          // Other status codes (400, 404, etc.) - preserve the original message
          message = error.message;
        }
      } else if (
        error.message.includes('storage') ||
        error.message.includes('space')
      ) {
        code = 'storage';
        message = error.message;
      } else {
        message = error.message;
      }
    } else {
      message = error.message;
    }
  } else {
    // Fallback for non-Error objects (e.g., from native JSI calls)
    // This handles cases where errors cross the JS-native boundary
    // and may not be proper Error instances
    if (error && typeof error === 'object' && 'message' in error) {
      message = String((error as {message: unknown}).message);
    } else if (typeof error === 'string') {
      message = error;
    } else if (error !== null && error !== undefined) {
      // Last resort: stringify the error
      try {
        message = JSON.stringify(error);
      } catch {
        message = String(error);
      }
    }
  }

  // Memory last, because it carries no status code: a native allocation
  // failure would otherwise land as 'unknown' and read as a broken model.
  let nativeMessage: string | undefined;
  if (code === 'unknown' && isMemoryError(error)) {
    code = 'memory';
    nativeMessage = message;
    message = l10nObject.errors.memoryError || message;
  }

  return {
    code,
    service: errorService,
    message,
    context,
    recoverable,
    severity,
    metadata: nativeMessage ? {...metadata, nativeMessage} : metadata,
  };
}

/**
 * Helper function to create a multimodal warning state
 */
export function createMultimodalWarning(
  message: string,
  context: ErrorState['context'] = 'chat',
): ErrorState {
  return {
    code: 'multimodal',
    message,
    context,
    recoverable: false,
    severity: 'warning',
  };
}

import {
  AuthorizationError,
  FetchResponseError,
  LoginError,
  OAuthResponseError,
  ResolverError,
  TokenRefreshError,
} from '@atcute/oauth-browser-client'
import { HttpError } from './atproto'
import { IdentityError } from './identity'
import { XrpcError } from './xrpc'

export type ErrorKind =
  | 'session-expired'
  | 'network'
  | 'rate-limited'
  | 'not-found'
  | 'permission'
  | 'conflict'
  | 'identity'
  | 'config'
  | 'unknown'

export type DescribedError = {
  kind: ErrorKind
  /** Safe, actionable text for the UI. Never contains tokens or raw payloads. */
  message: string
  retryable: boolean
}

/** Raised by the app's own checks, with a message already fit for the UI. */
export class AppError extends Error {
  constructor(
    readonly kind: ErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class SessionEndedError extends AppError {
  constructor(readonly notice?: string) {
    super('session-expired', 'Your session has ended. Please sign in again.')
    this.name = 'SessionEndedError'
  }
}

/** A compare-and-swap write lost: the record changed elsewhere (e.g. on bookhive.buzz). */
export class StaleRecordError extends AppError {
  constructor() {
    super('conflict', 'This book changed somewhere else since you opened it. Reload it and try again.')
    this.name = 'StaleRecordError'
  }
}

const EXPIRED: DescribedError = {
  kind: 'session-expired',
  message: 'Your session has expired. Please sign in again.',
  retryable: false,
}

/**
 * Maps any thrown value to a user-facing description. This is the only place
 * that turns transport errors into UI text, so nothing sensitive leaks out.
 */
export function describeError(err: unknown): DescribedError {
  if (err instanceof AppError) return { kind: err.kind, message: err.message, retryable: err.kind === 'conflict' }
  if (err instanceof IdentityError) {
    return { kind: 'identity', message: err.message, retryable: err.code === 'DidNotFound' }
  }
  if (err instanceof AuthorizationError) {
    return {
      kind: 'permission',
      message:
        err.error === 'access_denied'
          ? 'Sign-in was cancelled.'
          : 'Your server declined to authorise Papertrail. Try signing in again.',
      retryable: true,
    }
  }
  if (err instanceof LoginError) {
    return { kind: 'identity', message: "Couldn't sign in to that account. Check the handle or DID.", retryable: true }
  }
  if (err instanceof ResolverError) {
    return {
      kind: 'identity',
      message: "Couldn't find that account's sign-in server. Check the handle, or try your DID instead.",
      retryable: true,
    }
  }
  if (err instanceof TokenRefreshError) return EXPIRED
  if (err instanceof OAuthResponseError) {
    if (err.status >= 500) {
      return { kind: 'network', message: 'The sign-in server had a problem. Try again shortly.', retryable: true }
    }
    if (err.error === 'invalid_grant' || err.error === 'invalid_token') return EXPIRED
    if (err.error === 'invalid_request' && err.description) {
      return { kind: 'config', message: `Papertrail's sign-in is misconfigured: ${err.description}`, retryable: false }
    }
    return { kind: 'unknown', message: 'Sign-in failed. Please try again.', retryable: true }
  }
  // The reply wasn't the JSON the OAuth client expected.
  if (err instanceof FetchResponseError) {
    return { kind: 'network', message: 'The sign-in server sent an unexpected response. Try again shortly.', retryable: true }
  }
  if (err instanceof XrpcError || err instanceof HttpError) {
    const code = err.error ?? ''
    if (code === 'InvalidSwap') return describeError(new StaleRecordError())
    if (code === 'ExpiredToken' || code === 'InvalidToken' || err.status === 401) return EXPIRED
    if (code === 'RecordNotFound') {
      return { kind: 'not-found', message: 'That book no longer exists; it may have been deleted elsewhere.', retryable: false }
    }
    if (code === 'AccountTakedown') {
      return { kind: 'permission', message: 'This account has been suspended by its host.', retryable: false }
    }
    if (err.status === 429 || code === 'RateLimitExceeded') {
      return { kind: 'rate-limited', message: 'Too many requests. Wait a minute and try again.', retryable: true }
    }
    if (err.status === 403) {
      return { kind: 'permission', message: 'Your PDS refused this action (permission denied).', retryable: false }
    }
    if (err.status >= 500) {
      return { kind: 'network', message: `The server returned an error (${err.status}). Try again shortly.`, retryable: true }
    }
    return { kind: 'unknown', message: `Request failed${code ? ` (${code})` : ''}.`, retryable: false }
  }
  if (err instanceof TypeError && /fetch|network|load failed/i.test(err.message)) {
    return { kind: 'network', message: 'Network request failed. Check your connection and try again.', retryable: true }
  }
  return { kind: 'unknown', message: 'Something went wrong. Please try again.', retryable: true }
}

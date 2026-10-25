import { AuthorizationError, FetchResponseError, OAuthResponseError, TokenRefreshError } from '@atcute/oauth-browser-client'
import { describe, expect, it } from 'vitest'
import { describeError, SessionEndedError, StaleRecordError } from './errors'
import { XrpcError } from './xrpc'

describe('describeError for OAuth failures', () => {
  it('does not call a non-JSON token response an ended session', () => {
    const err = new FetchResponseError(new Response('nope', { status: 200 }), 2, 'unexpected content-type')
    expect(describeError(err)).toMatchObject({ kind: 'network', retryable: true })
  })

  it('treats a revoked refresh token as an ended session', () => {
    expect(describeError(new TokenRefreshError('did:plc:abc', 'session was revoked'))).toMatchObject({
      kind: 'session-expired',
      retryable: false,
    })
  })

  it('calls a cancelled sign-in a cancellation, not a failure', () => {
    expect(describeError(new AuthorizationError('access_denied', 'the user said no'))).toMatchObject({
      kind: 'permission',
      message: 'Sign-in was cancelled.',
    })
  })

  it('separates server trouble from a dead grant', () => {
    const outage = new OAuthResponseError(new Response('', { status: 503 }), { error: 'invalid_grant' })
    expect(describeError(outage)).toMatchObject({ kind: 'network', retryable: true })
    const dead = new OAuthResponseError(new Response('', { status: 400 }), { error: 'invalid_grant' })
    expect(describeError(dead)).toMatchObject({ kind: 'session-expired' })
  })

  it('surfaces a misconfigured client so it can be fixed', () => {
    const err = new OAuthResponseError(new Response('', { status: 400 }), {
      error: 'invalid_request',
      error_description: 'redirect_uri not registered',
    })
    expect(describeError(err).message).toContain('redirect_uri not registered')
  })
})

describe('describeError for PDS writes', () => {
  it('turns a lost compare-and-swap into a reload hint', () => {
    expect(describeError(new XrpcError(400, 'InvalidSwap', 'Record was at a different cid'))).toEqual(
      describeError(new StaleRecordError()),
    )
  })

  it('maps rate limits and auth failures', () => {
    expect(describeError(new XrpcError(429, 'RateLimitExceeded', 'slow down'))).toMatchObject({ kind: 'rate-limited' })
    expect(describeError(new XrpcError(401, 'InvalidToken', 'bad'))).toMatchObject({ kind: 'session-expired' })
  })

  it('never echoes raw server text for unknown errors', () => {
    const described = describeError(new XrpcError(400, 'Weird', 'token=secret'))
    expect(described.message).not.toContain('secret')
  })
})

describe('SessionEndedError', () => {
  it('carries an optional, more specific notice', () => {
    expect(new SessionEndedError('Your account has moved.').notice).toBe('Your account has moved.')
  })
})

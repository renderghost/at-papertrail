// @vitest-environment happy-dom
import { FetchResponseError, OAuthResponseError, TokenRefreshError } from '@atcute/oauth-browser-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_DID as DID, TEST_PDS as PDS, oauthSessionFixture, stubOAuthRuntime } from '../test/oauth'
import { SessionEndedError } from './errors'
import { IdentityError } from './identity'
import {
  createFetchHandler,
  describeOAuthError,
  finishOAuthSignIn,
  hasOAuthCallbackParams,
  hasStoredOAuthSession,
  readOAuthCallbackParams,
  resumeOAuthSession,
  startOAuthSignIn,
} from './oauth'

const rpc = vi.hoisted(() => ({
  getSession: vi.fn<typeof import('@atcute/oauth-browser-client').getSession>(),
  deleteStoredSession: vi.fn<typeof import('@atcute/oauth-browser-client').deleteStoredSession>(),
  listStoredSessions: vi.fn<typeof import('@atcute/oauth-browser-client').listStoredSessions>(),
  createAuthorizationUrl: vi.fn<typeof import('@atcute/oauth-browser-client').createAuthorizationUrl>(),
  finalizeAuthorization: vi.fn<typeof import('@atcute/oauth-browser-client').finalizeAuthorization>(),
  resolveDidDocument: vi.fn<typeof import('./identity').resolveDidDocument>(),
}))

vi.mock('@atcute/oauth-browser-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@atcute/oauth-browser-client')>()
  return {
    ...actual,
    getSession: rpc.getSession,
    deleteStoredSession: rpc.deleteStoredSession,
    listStoredSessions: rpc.listStoredSessions,
    createAuthorizationUrl: rpc.createAuthorizationUrl,
    finalizeAuthorization: rpc.finalizeAuthorization,
  }
})

vi.mock('./identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./identity')>()
  return { ...actual, resolveDidDocument: rpc.resolveDidDocument }
})

beforeEach(() => {
  vi.resetAllMocks()
  stubOAuthRuntime()
  rpc.listStoredSessions.mockReturnValue([DID])
  rpc.resolveDidDocument.mockRejectedValue(new Error('offline'))
})

afterEach(() => vi.unstubAllGlobals())

function at(url: string) {
  stubOAuthRuntime(new URL(url, 'http://127.0.0.1:5173').href)
}

const moved = {
  service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://new-pds.example.com' }],
}

describe('readOAuthCallbackParams', () => {
  it('reads the authorization response out of the fragment', () => {
    at('/#state=6e8BEK7JT0k7OEnsJbRVRYLH&iss=https%3A%2F%2Faster.id&code=cod-36aadc8e')
    expect(readOAuthCallbackParams().get('code')).toBe('cod-36aadc8e')
    expect(readOAuthCallbackParams().get('iss')).toBe('https://aster.id')
    expect(hasOAuthCallbackParams()).toBe(true)
  })

  it('falls back to the query string when the server ignores the requested mode', () => {
    at('/?state=abc&iss=https%3A%2F%2Fbsky.social&code=cod-query')
    expect(readOAuthCallbackParams().get('code')).toBe('cod-query')
  })

  it('finds an error response too', () => {
    at('/#state=abc&error=access_denied')
    expect(hasOAuthCallbackParams()).toBe(true)
    expect(readOAuthCallbackParams().get('error')).toBe('access_denied')
  })

  it('reports no callback on an ordinary visit', () => {
    at('/book/bk_abc?q=dune')
    expect(hasOAuthCallbackParams()).toBe(false)
  })
})

describe('hasStoredOAuthSession', () => {
  it('reports a misconfigured origin instead of claiming there is no session', () => {
    // OAuth state is per-origin: sign-in on localhost can never complete on 127.0.0.1.
    at('http://localhost:5173/')
    expect(() => hasStoredOAuthSession()).toThrow(/127\.0\.0\.1/)
  })

  it('reads the token store on a supported origin', () => {
    expect(hasStoredOAuthSession()).toBe(true)
    rpc.listStoredSessions.mockReturnValue([])
    expect(hasStoredOAuthSession()).toBe(false)
  })
})

describe('startOAuthSignIn', () => {
  it('rejects an invalid identifier before contacting anyone', async () => {
    await expect(startOAuthSignIn('alice')).rejects.toBeInstanceOf(IdentityError)
    expect(rpc.createAuthorizationUrl).not.toHaveBeenCalled()
  })

  it('asks only for the collections Papertrail writes, and remembers where to return', async () => {
    rpc.createAuthorizationUrl.mockResolvedValue(new URL('https://pds.example.com/oauth/authorize?x=1'))
    void startOAuthSignIn('@Alice.Test', '/book/bk_abc')
    await vi.waitFor(() => expect(globalThis.location.assign).toHaveBeenCalled())
    expect(rpc.createAuthorizationUrl).toHaveBeenCalledWith({
      target: { type: 'account', identifier: 'alice.test' },
      scope:
        'atproto repo:buzz.bookhive.book repo:social.popfeed.feed.list repo:social.popfeed.feed.listItem ' +
        'repo:social.popfeed.actor.profile repo:app.bsky.graph.follow?action=create&action=delete',
      state: { returnTo: '/book/bk_abc' },
    })
    expect(globalThis.location.assign).toHaveBeenCalledWith('https://pds.example.com/oauth/authorize?x=1')
  })

  it('never carries an off-site return path through the PDS', async () => {
    rpc.createAuthorizationUrl.mockResolvedValue(new URL('https://pds.example.com/oauth/authorize'))
    void startOAuthSignIn('alice.test', '//evil.example/steal')
    await vi.waitFor(() => expect(rpc.createAuthorizationUrl).toHaveBeenCalled())
    expect(rpc.createAuthorizationUrl.mock.calls[0]![0].state).toEqual({ returnTo: null })
  })
})

describe('finishOAuthSignIn', () => {
  it('builds a session and keeps an in-app return path', async () => {
    rpc.finalizeAuthorization.mockResolvedValue({ session: await oauthSessionFixture(), state: { returnTo: '/club' } })
    rpc.resolveDidDocument.mockResolvedValue({ id: DID, alsoKnownAs: ['at://alice.test'] })

    const { session, returnTo } = await finishOAuthSignIn(new URLSearchParams('code=x&state=y'))

    expect(session).toMatchObject({ did: DID, handle: 'alice.test', pds: PDS })
    expect(returnTo).toBe('/club')
  })

  it('drops a return path that leaves the app', async () => {
    rpc.finalizeAuthorization.mockResolvedValue({
      session: await oauthSessionFixture(),
      state: { returnTo: 'https://evil.example/' },
    })
    expect((await finishOAuthSignIn(new URLSearchParams('code=x'))).returnTo).toBeNull()
  })
})

describe('createFetchHandler', () => {
  const respond = (status: number, wwwAuthenticate?: string) =>
    new Response('{}', { status, headers: wwwAuthenticate ? { 'www-authenticate': wwwAuthenticate } : {} })

  async function harness(response: Response) {
    const notices: (string | undefined)[] = []
    const handler = createFetchHandler({ handle: async () => response }, DID, PDS, (n) => notices.push(n))
    const result = await handler('/xrpc/com.atproto.repo.putRecord', {})
    return { result, notices }
  }

  it.each(['DPoP', 'Bearer'])('keeps the session when a rejected %s token can still refresh', async (scheme) => {
    rpc.getSession.mockResolvedValue(await oauthSessionFixture())

    const { notices } = await harness(respond(401, `${scheme} error="invalid_token"`))

    expect(notices).toEqual([])
    expect(rpc.deleteStoredSession).not.toHaveBeenCalled()
    expect(rpc.getSession).toHaveBeenCalledExactlyOnceWith(DID, { noCache: true })
  })

  it('ends the session, then explains it, when the grant is dead because the account moved', async () => {
    rpc.getSession.mockRejectedValue(new TokenRefreshError(DID, 'revoked'))
    rpc.resolveDidDocument.mockResolvedValue(moved)

    const { notices } = await harness(respond(401, 'DPoP error="invalid_token"'))

    expect(notices).toEqual([undefined, 'Your account has moved to new-pds.example.com. Sign in again to reconnect.'])
    expect(rpc.deleteStoredSession).toHaveBeenCalledWith(DID)
  })

  it('leaves everything alone for responses that are not token rejections', async () => {
    for (const response of [
      respond(200),
      respond(401),
      respond(401, 'Bearer realm="atproto"'),
      respond(429),
      respond(500, 'DPoP error="invalid_token"'),
    ]) {
      const { notices, result } = await harness(response)
      expect(result).toBe(response)
      expect(notices).toEqual([])
    }
    expect(rpc.getSession).not.toHaveBeenCalled()
    expect(rpc.deleteStoredSession).not.toHaveBeenCalled()
  })
})

describe('resumeOAuthSession', () => {
  it('reads the issuing PDS without refreshing, then restores a usable session', async () => {
    const stored = await oauthSessionFixture()
    rpc.getSession.mockResolvedValue(stored)
    rpc.resolveDidDocument.mockResolvedValue({ id: DID, alsoKnownAs: ['at://alice.test'] })

    const session = await resumeOAuthSession()

    expect(session).toMatchObject({ did: DID, handle: 'alice.test', pds: stored.info.aud })
    expect(rpc.getSession.mock.calls).toEqual([[DID, { allowStale: true }], [DID]])
    expect(rpc.deleteStoredSession).not.toHaveBeenCalled()
  })

  it('falls back to the DID as the handle when the directory is unreachable', async () => {
    rpc.getSession.mockResolvedValue(await oauthSessionFixture())
    expect((await resumeOAuthSession())?.handle).toBe(DID)
  })

  it('ends the session when refreshing the stored grant fails permanently', async () => {
    rpc.getSession
      .mockResolvedValueOnce(await oauthSessionFixture())
      .mockRejectedValueOnce(new TokenRefreshError(DID, 'session was revoked'))

    await expect(resumeOAuthSession()).rejects.toBeInstanceOf(SessionEndedError)
    expect(rpc.deleteStoredSession).toHaveBeenCalledWith(DID)
  })

  it.each([
    new TypeError('Failed to fetch'),
    new FetchResponseError(new Response('nope', { status: 200 }), 2, 'unexpected content-type'),
    new OAuthResponseError(new Response('', { status: 503 }), { error: 'server_error' }),
  ])('keeps the stored grant after a transient refresh failure: %s', async (error) => {
    rpc.getSession.mockResolvedValueOnce(await oauthSessionFixture()).mockRejectedValueOnce(error)

    await expect(resumeOAuthSession()).rejects.toBe(error)
    expect(rpc.deleteStoredSession).not.toHaveBeenCalled()
  })

  it('recognises invalid_grant even when atcute does not wrap it', async () => {
    rpc.getSession
      .mockResolvedValueOnce(await oauthSessionFixture())
      .mockRejectedValueOnce(new OAuthResponseError(new Response('', { status: 503 }), { error: 'invalid_grant' }))

    await expect(resumeOAuthSession()).rejects.toBeInstanceOf(SessionEndedError)
    expect(rpc.deleteStoredSession).toHaveBeenCalledWith(DID)
  })

  it('reports a migration using the PDS saved before the failed refresh', async () => {
    rpc.getSession
      .mockResolvedValueOnce(await oauthSessionFixture())
      .mockRejectedValueOnce(new TokenRefreshError(DID, 'session was revoked'))
    rpc.resolveDidDocument.mockResolvedValue(moved)

    const error = await resumeOAuthSession().catch((err: unknown) => err)

    expect(describeOAuthError(error)).toBe('Your account has moved to new-pds.example.com. Sign in again to reconnect.')
  })

  it('returns null without touching the token store when nothing is saved', async () => {
    rpc.listStoredSessions.mockReturnValue([])
    await expect(resumeOAuthSession()).resolves.toBeNull()
    expect(rpc.getSession).not.toHaveBeenCalled()
  })
})

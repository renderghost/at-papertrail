// @vitest-environment happy-dom
import type { OAuthUserAgent } from '@atcute/oauth-browser-client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_DID, TEST_PDS, stubOAuthRuntime } from '../test/oauth'
import { AuthProvider, resetRestoreLatchForTests, useAuth } from './auth'
import type { OAuthSession } from './oauth'

const svc = vi.hoisted(() => ({
  clearStoredOAuthSessions: vi.fn<typeof import('./oauth').clearStoredOAuthSessions>(),
  describeOAuthError: vi.fn((err: unknown) => `described: ${String(err)}`),
  finishOAuthSignIn: vi.fn<typeof import('./oauth').finishOAuthSignIn>(),
  hasOAuthCallbackParams: vi.fn(() => false),
  hasStoredOAuthSession: vi.fn(() => false),
  readOAuthCallbackParams: vi.fn(() => new URLSearchParams()),
  resumeOAuthSession: vi.fn<typeof import('./oauth').resumeOAuthSession>(),
  signOutOAuthSession: vi.fn<typeof import('./oauth').signOutOAuthSession>(),
  startOAuthSignIn: vi.fn<typeof import('./oauth').startOAuthSignIn>(),
}))

vi.mock('./oauth', () => svc)

let oauthSession: OAuthSession
let queryClient: QueryClient
const replaceState = vi.spyOn(globalThis.history, 'replaceState')

function Harness() {
  const { state, signOut } = useAuth()
  const location = useLocation()
  return (
    <div>
      <span data-testid="status">{state.status}</span>
      <span data-testid="notice">{state.status === 'signed-out' ? (state.notice ?? '') : ''}</span>
      <span data-testid="path">{location.pathname}</span>
      <button onClick={() => void signOut()}>sign out</button>
    </div>
  )
}

function renderProvider(strict = false) {
  const ui = (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AuthProvider>
          <Harness />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return render(strict ? <StrictMode>{ui}</StrictMode> : ui)
}

const status = () => screen.getByTestId('status').textContent
const notice = () => screen.getByTestId('notice').textContent

beforeEach(() => {
  vi.resetAllMocks()
  stubOAuthRuntime()
  resetRestoreLatchForTests()
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  svc.describeOAuthError.mockImplementation((err) => `described: ${String(err)}`)
  svc.readOAuthCallbackParams.mockReturnValue(new URLSearchParams())
  svc.hasOAuthCallbackParams.mockReturnValue(false)
  svc.hasStoredOAuthSession.mockReturnValue(false)
  svc.resumeOAuthSession.mockResolvedValue(null)
  // The provider only passes the session through; the OAuth service has its own tests.
  oauthSession = {
    did: TEST_DID,
    handle: 'alice.test',
    pds: TEST_PDS,
    scope: 'atproto repo:buzz.bookhive.book',
    userAgent: {} as OAuthUserAgent,
    fetchHandler: vi.fn(),
  }
  replaceState.mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AuthProvider: first render', () => {
  it('goes straight to sign-in when there is nothing to restore', () => {
    renderProvider()
    expect(status()).toBe('signed-out')
    expect(svc.resumeOAuthSession).not.toHaveBeenCalled()
  })

  it('restores a stored session', async () => {
    svc.hasStoredOAuthSession.mockReturnValue(true)
    svc.resumeOAuthSession.mockResolvedValue(oauthSession)

    renderProvider()
    expect(status()).toBe('restoring')
    await waitFor(() => expect(status()).toBe('signed-in'))
  })

  it('restores only once under StrictMode and keeps the expiry callback', async () => {
    svc.hasStoredOAuthSession.mockReturnValue(true)
    svc.resumeOAuthSession.mockResolvedValue(oauthSession)

    renderProvider(true)
    await waitFor(() => expect(status()).toBe('signed-in'))
    expect(svc.resumeOAuthSession).toHaveBeenCalledTimes(1)

    act(() => svc.resumeOAuthSession.mock.calls[0]![0]!())
    expect(status()).toBe('signed-out')
    expect(notice()).toBe('Your session ended. Please sign in again.')
  })

  it('explains a misconfigured origin instead of offering a form that cannot work', () => {
    svc.hasStoredOAuthSession.mockImplementation(() => {
      throw new Error('Sign-in needs Papertrail served on 127.0.0.1')
    })
    renderProvider()
    expect(status()).toBe('signed-out')
    expect(notice()).toContain('127.0.0.1')
  })
})

describe('AuthProvider: callbacks', () => {
  it('finishes a callback, removes its single-use parameters and returns to the page', async () => {
    const params = new URLSearchParams('code=one-use&state=test')
    stubOAuthRuntime('http://127.0.0.1:5173/?code=one-use&state=test#code=one-use')
    svc.hasOAuthCallbackParams.mockReturnValue(true)
    svc.readOAuthCallbackParams.mockReturnValue(params)
    svc.finishOAuthSignIn.mockResolvedValue({ session: oauthSession, returnTo: '/book/bk_abc' })

    renderProvider()
    await waitFor(() => expect(status()).toBe('signed-in'))

    expect(svc.finishOAuthSignIn).toHaveBeenCalledWith(params, expect.any(Function))
    expect(svc.resumeOAuthSession).not.toHaveBeenCalled()
    expect(String(replaceState.mock.calls[0]![2])).toBe('http://127.0.0.1:5173/')
    // The router applies the navigation in a later render than the sign-in itself.
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/book/bk_abc'))
  })

  it('resumes the existing session when a callback cannot be finished', async () => {
    svc.hasOAuthCallbackParams.mockReturnValue(true)
    svc.finishOAuthSignIn.mockRejectedValue(new Error('bad state'))
    svc.resumeOAuthSession.mockResolvedValue(oauthSession)

    renderProvider()
    await waitFor(() => expect(status()).toBe('signed-in'))
    expect(replaceState).toHaveBeenCalled()
  })

  it('reports the callback error when there is no session to fall back to', async () => {
    svc.hasOAuthCallbackParams.mockReturnValue(true)
    svc.finishOAuthSignIn.mockRejectedValue(new Error('Access denied'))

    renderProvider()
    await waitFor(() => expect(status()).toBe('signed-out'))
    expect(notice()).toBe('described: Error: Access denied')
  })

  it('shows the reason when a transient failure leaves the grant intact', async () => {
    svc.hasStoredOAuthSession.mockReturnValue(true)
    svc.resumeOAuthSession.mockRejectedValue(new Error('server had a problem'))

    renderProvider()
    await waitFor(() => expect(status()).toBe('signed-out'))
    expect(notice()).toBe('described: Error: server had a problem')
  })
})

describe('AuthProvider: session end and sign-out', () => {
  async function signedIn() {
    svc.hasStoredOAuthSession.mockReturnValue(true)
    svc.resumeOAuthSession.mockResolvedValue(oauthSession)
    renderProvider()
    await waitFor(() => expect(status()).toBe('signed-in'))
    return svc.resumeOAuthSession.mock.calls.at(-1)![0]!
  }

  it('refines a generic expiry notice without letting a later generic one overwrite it', async () => {
    const onEnded = await signedIn()

    act(() => onEnded())
    expect(notice()).toBe('Your session ended. Please sign in again.')
    act(() => onEnded('Your account has moved to new-pds.example.com. Sign in again to reconnect.'))
    expect(notice()).toContain('new-pds.example.com')
    act(() => onEnded())
    expect(notice()).toContain('new-pds.example.com')
  })

  it('clears cached data from the ended session', async () => {
    const onEnded = await signedIn()
    queryClient.setQueryData(['library', oauthSession.did], ['a book'])

    act(() => onEnded())
    expect(queryClient.getQueryData(['library', oauthSession.did])).toBeUndefined()
  })

  it('ignores an expiry that lands after the user signed out on purpose', async () => {
    const onEnded = await signedIn()
    svc.signOutOAuthSession.mockResolvedValue(undefined)

    fireEvent.click(screen.getByText('sign out'))
    await waitFor(() => expect(status()).toBe('signed-out'))
    act(() => onEnded('Your account has moved to another server.'))
    expect(notice()).toBe('')
    expect(svc.clearStoredOAuthSessions).toHaveBeenCalled()
  })

  it('still signs out locally when the server rejects the revocation', async () => {
    await signedIn()
    svc.signOutOAuthSession.mockRejectedValue(new Error('network down'))

    fireEvent.click(screen.getByText('sign out'))
    await waitFor(() => expect(status()).toBe('signed-out'))
    expect(notice()).toBe('')
    expect(svc.clearStoredOAuthSessions).toHaveBeenCalled()
  })
})

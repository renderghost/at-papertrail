import { BrowserOAuthClient, type OAuthSession } from '@atproto/oauth-client-browser'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { networkStore } from './network'
import { loopbackClientId, OAUTH_SCOPE } from './oauthConfig'

/**
 * Browser-only OAuth: tokens live in this browser's IndexedDB and every write
 * goes straight from here to the user's PDS. No server sees them.
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost'])

function isLoopback(): boolean {
  return LOOPBACK_HOSTS.has(window.location.hostname)
}

let clientPromise: Promise<BrowserOAuthClient> | null = null
/** Called when the PDS revokes the session or a refresh fails for good. */
const onSessionEnded = new Set<() => void>()

function getClient(): Promise<BrowserOAuthClient> {
  clientPromise ??= BrowserOAuthClient.load({
    clientId: isLoopback()
      ? loopbackClientId({ port: window.location.port, pathname: import.meta.env.BASE_URL })
      : `${__SITE_URL__}client-metadata.json`,
    handleResolver: 'https://public.api.bsky.app',
    onSessionDeleted: () => onSessionEnded.forEach((fn) => fn()),
  })
  return clientPromise
}

let initPromise: ReturnType<BrowserOAuthClient['init']> | null = null

/** Restores a session or completes a sign-in callback. Must run once per page load: callback state is single-use. */
function initOnce(): ReturnType<BrowserOAuthClient['init']> {
  initPromise ??= getClient().then((client) => client.init())
  return initPromise
}

type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut'; error?: string }
  | { status: 'signedIn'; did: string; session: OAuthSession }

type AuthContextValue = {
  state: AuthState
  signIn: (handle: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function describe(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (/resolve|handle|not found/i.test(message)) {
    return "We couldn't find that account. Check the handle, e.g. alice.bsky.social."
  }
  return message
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  useEffect(() => {
    // The loopback OAuth flow redirects to 127.0.0.1; IndexedDB is per-origin, so stay there.
    if (window.location.hostname === 'localhost') {
      const url = new URL(window.location.href)
      url.hostname = '127.0.0.1'
      window.location.replace(url)
      return
    }
    let cancelled = false
    const ended = () => {
      networkStore.reset()
      setState({ status: 'signedOut', error: 'Your session ended. Please sign in again.' })
    }
    onSessionEnded.add(ended)
    initOnce()
      .then((result) => {
        if (cancelled) return
        if (result?.session) {
          setState({ status: 'signedIn', did: result.session.did, session: result.session })
        } else {
          setState({ status: 'signedOut' })
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: 'signedOut', error: describe(err) })
      })
    return () => {
      cancelled = true
      onSessionEnded.delete(ended)
    }
  }, [])

  const signIn = useCallback(async (handle: string) => {
    const client = await getClient()
    try {
      await client.signInRedirect(handle.trim().replace(/^@/, ''), { scope: OAUTH_SCOPE })
    } catch (err) {
      setState({ status: 'signedOut', error: describe(err) })
    }
  }, [])

  const signOut = useCallback(async () => {
    if (state.status !== 'signedIn') return
    try {
      await state.session.signOut()
    } finally {
      networkStore.reset()
      setState({ status: 'signedOut' })
    }
  }, [state])

  return <AuthContext.Provider value={{ state, signIn, signOut }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}

/** The signed-in user. Only call this beneath the signed-in part of the app. */
export function useSession(): { did: string; session: OAuthSession } {
  const { state } = useAuth()
  if (state.status !== 'signedIn') throw new Error('Not signed in')
  return { did: state.did, session: state.session }
}

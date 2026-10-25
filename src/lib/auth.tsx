import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { networkStore } from './network'
import {
  clearStoredOAuthSessions,
  describeOAuthError,
  finishOAuthSignIn,
  hasOAuthCallbackParams,
  hasStoredOAuthSession,
  readOAuthCallbackParams,
  resumeOAuthSession,
  signOutOAuthSession,
  startOAuthSignIn as startOAuthSignInService,
  type OAuthSession,
  type SessionEndedCallback,
} from './oauth'

export type AuthState =
  | { status: 'restoring' }
  | { status: 'signed-out'; notice?: string }
  | { status: 'signed-in'; session: OAuthSession }

type AuthContextValue = {
  state: AuthState
  /** Redirects to the account's PDS; `returnTo` is the in-app path to land on afterwards. */
  startOAuthSignIn: (identifier: string, returnTo?: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

type Restored = { session: OAuthSession; returnTo: string | null } | null

// Restore at most once per page load. Refresh tokens and callback codes are
// single-use, so a second concurrent restore (e.g. React StrictMode) would
// revoke the first.
let restoreOnce: Promise<Restored> | null = null

/** Lets tests isolate themselves without changing the per-page latch. */
export function resetRestoreLatchForTests(): void {
  restoreOnce = null
}

/** The authorization response is single-use: never leave it in the URL or history. */
function clearOAuthParams() {
  const url = new URL(globalThis.location.href)
  url.search = ''
  url.hash = ''
  globalThis.history.replaceState({}, '', url)
}

async function restoreSession(onEnded: SessionEndedCallback): Promise<Restored> {
  if (hasOAuthCallbackParams()) {
    const params = readOAuthCallbackParams()
    clearOAuthParams()
    try {
      return await finishOAuthSignIn(params, onEnded)
    } catch (err) {
      // A stale or replayed callback shouldn't sign out someone who's already signed in.
      const existing = await resumeOAuthSession(onEnded).catch(() => null)
      if (existing) return { session: existing, returnTo: null }
      throw err
    }
  }
  const session = await resumeOAuthSession(onEnded)
  return session ? { session, returnTo: null } : null
}

function initialState(): AuthState {
  let stored: boolean
  try {
    stored = hasStoredOAuthSession()
  } catch (err) {
    // Misconfiguration (e.g. served on localhost): explain rather than show a form that can't work.
    return { status: 'signed-out', notice: describeOAuthError(err) }
  }
  // Only show "restoring" when there's something to restore; otherwise go straight to sign-in.
  return hasOAuthCallbackParams() || stored ? { status: 'restoring' } : { status: 'signed-out' }
}

/** "/at-papertrail/book/x" → "/book/x", for the router, which works below the base path. */
function routerPath(appPath: string): string {
  const base = import.meta.env.BASE_URL
  return `/${appPath.slice(base.length)}`
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [state, setState] = useState<AuthState>(initialState)
  const signingOut = useRef(false)
  // Expiry callbacks are tied to the session that issued them; a newer session ignores older ones.
  const generation = useRef(0)

  /** Nothing cached for one account may be shown to the next. */
  const clearAppState = useCallback(() => {
    queryClient.clear()
    networkStore.reset()
  }, [queryClient])

  // A later migration lookup may refine the first, generic expiry notice.
  const makeOnEnded = useCallback((): SessionEndedCallback => {
    const issuedFor = generation.current
    return (notice) => {
      if (signingOut.current || issuedFor !== generation.current) return
      clearAppState()
      setState((prev) => {
        // A generic expiry must not overwrite a specific explanation.
        if (prev.status === 'signed-out') return notice ? { status: 'signed-out', notice } : prev
        return { status: 'signed-out', notice: notice ?? 'Your session ended. Please sign in again.' }
      })
    }
  }, [clearAppState])

  useEffect(() => {
    if (state.status !== 'restoring') return
    if (!restoreOnce) {
      generation.current += 1
      restoreOnce = restoreSession(makeOnEnded())
    }
    let cancelled = false
    restoreOnce.then(
      (restored) => {
        if (cancelled) return
        if (!restored) {
          setState({ status: 'signed-out' })
          return
        }
        setState({ status: 'signed-in', session: restored.session })
        if (restored.returnTo) navigate(routerPath(restored.returnTo), { replace: true })
      },
      (err: unknown) => {
        if (!cancelled) setState({ status: 'signed-out', notice: describeOAuthError(err) })
      },
    )
    return () => {
      cancelled = true
    }
  }, [state.status, makeOnEnded, navigate])

  const startOAuthSignIn = useCallback(async (identifier: string, returnTo?: string) => {
    signingOut.current = false
    await startOAuthSignInService(identifier, returnTo)
  }, [])

  const signOut = useCallback(async () => {
    if (state.status !== 'signed-in') return
    signingOut.current = true
    try {
      await signOutOAuthSession(state.session)
    } catch {
      // The server-side session may outlive this, but local credentials are gone.
    } finally {
      clearStoredOAuthSessions()
      generation.current += 1
      restoreOnce = null
      clearAppState()
      setState({ status: 'signed-out' })
    }
  }, [state, clearAppState])

  const value = useMemo(() => ({ state, startOAuthSignIn, signOut }), [state, startOAuthSignIn, signOut])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}

/** The signed-in user. Only call this beneath the signed-in part of the app. */
export function useSession(): { did: string; session: OAuthSession } {
  const { state } = useAuth()
  if (state.status !== 'signed-in') throw new Error('useSession requires a signed-in session')
  return { did: state.session.did, session: state.session }
}

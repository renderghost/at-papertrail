/**
 * Browser-only OAuth, modelled on renderghost/at-assemblage#13.
 *
 * Tokens live in this browser (atcute's store, keyed by DID) and every write
 * goes straight from here to the user's PDS. The rules that matter:
 * - a callback's parameters are single-use, so they're consumed once and
 *   removed from the URL;
 * - credentials are deleted only when the grant is provably dead, never on a
 *   network blip, so a reload can retry;
 * - when a session does end, say why if we can (e.g. the account moved PDS).
 */
import {
  CompositeDidDocumentResolver,
  CompositeHandleResolver,
  DohJsonHandleResolver,
  LocalActorResolver,
  PlcDidDocumentResolver,
  WebDidDocumentResolver,
  XrpcHandleResolver,
} from '@atcute/identity-resolver'
import type { ActorIdentifier, Did } from '@atcute/lexicons'
import {
  OAuthResponseError,
  OAuthUserAgent,
  TokenRefreshError,
  configureOAuth,
  createAuthorizationUrl,
  deleteStoredSession,
  finalizeAuthorization,
  getSession,
  listStoredSessions,
} from '@atcute/oauth-browser-client'
import { AppError, SessionEndedError, describeError } from './errors'
import {
  HANDLE_RESOLVER,
  IdentityError,
  PLC_DIRECTORY,
  checkIdentifier,
  handleFromDidDocument,
  pdsFromDidDocument,
  resolveDidDocument,
} from './identity'
import { OAUTH_SCOPE } from './oauthConfig'
import { originMismatch } from './siteUrl'
import type { SessionFetch } from './xrpc'

export type OAuthSession = SessionFetch & {
  did: Did
  handle: string
  pds: string
  userAgent: OAuthUserAgent
}

export type SessionEndedCallback = (notice?: string) => void

const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

/** Where the app is served: origin plus Vite's base path, always ending in "/". */
function appUrl(origin: string): string {
  return `${origin}${import.meta.env.BASE_URL}`
}

/** atproto's loopback client: no metadata document, but it must redirect to 127.0.0.1. */
function loopbackClient(origin: string): { client_id: string; redirect_uri: string } {
  const { port } = new URL(origin)
  const redirect_uri = `http://127.0.0.1${port ? `:${port}` : ''}${import.meta.env.BASE_URL}`
  return {
    client_id:
      `http://localhost?redirect_uri=${encodeURIComponent(redirect_uri)}` +
      `&scope=${encodeURIComponent(OAUTH_SCOPE)}`,
    redirect_uri,
  }
}

let configuredOrigin: string | null = null

function ensureConfigured(): void {
  const origin = globalThis.location?.origin ?? ''
  if (configuredOrigin === origin) return

  if (LOOPBACK.test(origin) && new URL(origin).hostname === 'localhost') {
    // OAuth state is per-origin; a redirect from localhost to 127.0.0.1 would lose it.
    throw new AppError(
      'config',
      `Sign-in needs Papertrail served on 127.0.0.1, not localhost. Open ${origin.replace('localhost', '127.0.0.1')}${import.meta.env.BASE_URL} instead.`,
    )
  }
  // e.g. a production deployment's unique *.vercel.app URL: its metadata names the production domain.
  const mismatch = originMismatch(origin, __SITE_URL__)
  if (mismatch) throw new AppError('config', mismatch)

  const metadata = LOOPBACK.test(origin)
    ? loopbackClient(origin)
    : { client_id: `${appUrl(origin)}client-metadata.json`, redirect_uri: appUrl(origin) }

  configureOAuth({
    metadata,
    identityResolver: new LocalActorResolver({
      handleResolver: new CompositeHandleResolver({
        strategy: 'race',
        methods: {
          dns: new DohJsonHandleResolver({ dohUrl: 'https://mozilla.cloudflare-dns.com/dns-query' }),
          http: new XrpcHandleResolver({ serviceUrl: HANDLE_RESOLVER }),
        },
      }),
      didDocumentResolver: new CompositeDidDocumentResolver({
        methods: {
          plc: new PlcDidDocumentResolver({ apiUrl: PLC_DIRECTORY }),
          web: new WebDidDocumentResolver(),
        },
      }),
    }),
  })
  configuredOrigin = origin
}

/** A 401 carrying `invalid_token`. A rejected access token alone doesn't prove the grant was revoked. */
export function isInvalidTokenResponse(response: Response): boolean {
  if (response.status !== 401) return false
  const auth = response.headers.get('www-authenticate')
  return (
    auth != null && (auth.startsWith('Bearer ') || auth.startsWith('DPoP ')) && auth.includes('error="invalid_token"')
  )
}

/** atcute wraps invalid_grant only on HTTP 400; other transport failures are not revocation. */
function isDeadGrantError(err: unknown): boolean {
  if (err instanceof TokenRefreshError) return true
  return err instanceof OAuthResponseError && err.error === 'invalid_grant'
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return a.replace(/\/+$/, '') === b.replace(/\/+$/, '')
  }
}

/** Explains an ended session when the account has moved to another PDS. */
async function explainSessionEnd(did: Did, sessionPds: string): Promise<string | undefined> {
  try {
    const currentPds = pdsFromDidDocument(await resolveDidDocument(did))
    if (currentPds && !sameOrigin(currentPds, sessionPds)) {
      return `Your account has moved to ${new URL(currentPds).host}. Sign in again to reconnect.`
    }
  } catch {
    // Offline or the directory is unreachable: a plain sign-out notice is enough.
  }
  return undefined
}

/** The user agent hides refresh failures, so force a probe: cached tokens can be revoked before they expire. */
async function isGrantDead(did: Did): Promise<boolean> {
  try {
    await getSession(did, { noCache: true })
    return false
  } catch (err) {
    return isDeadGrantError(err)
  }
}

/**
 * Wraps the user agent's DPoP fetch handler: when the PDS rejects the token and
 * the grant turns out to be dead, the stored session is removed and the app told.
 */
export function createFetchHandler(
  userAgent: Pick<OAuthUserAgent, 'handle'>,
  did: Did,
  pds: string,
  onSessionEnded: SessionEndedCallback,
): SessionFetch['fetchHandler'] {
  // Notify once straight away, then once more if a migration explains the failure.
  let ended = false
  let explained = false
  return async (path, init) => {
    const response = await userAgent.handle(path, init)
    if (!isInvalidTokenResponse(response)) return response
    if (!(await isGrantDead(did))) return response

    deleteStoredSession(did)
    if (!ended) {
      ended = true
      onSessionEnded()
    }
    const notice = await explainSessionEnd(did, pds)
    if (notice && !explained) {
      explained = true
      onSessionEnded(notice)
    }
    return response
  }
}

async function toOAuthSession(userAgent: OAuthUserAgent, onSessionEnded: SessionEndedCallback = () => {}): Promise<OAuthSession> {
  const did = userAgent.sub
  let handle: string = did
  try {
    handle = handleFromDidDocument(await resolveDidDocument(did)) ?? did
  } catch {
    // A failed DID document fetch must not block sign-in.
  }
  const pds = userAgent.session.info.aud
  return { did, handle, pds, userAgent, fetchHandler: createFetchHandler(userAgent, did, pds, onSessionEnded) }
}

/** Where to land after sign-in: an in-app path only, never another origin. */
function safeReturnTo(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const base = import.meta.env.BASE_URL
  return value.startsWith(base) && !value.startsWith('//') && !value.includes('\\') ? value : null
}

/** Sends the browser to the account's own PDS to approve access. Never resolves. */
export async function startOAuthSignIn(identifier: string, returnTo?: string): Promise<never> {
  ensureConfigured()
  const check = checkIdentifier(identifier)
  if (!check.ok) throw new IdentityError('InvalidIdentifier', check.message)

  const url = await createAuthorizationUrl({
    target: { type: 'account', identifier: check.value as ActorIdentifier },
    scope: OAUTH_SCOPE,
    state: { returnTo: safeReturnTo(returnTo) },
  })
  globalThis.location.assign(url.toString())
  // Keep the caller busy until navigation replaces the document.
  return new Promise<never>(() => {})
}

export function readOAuthCallbackParams(): URLSearchParams {
  const { hash, search } = globalThis.location
  const fromHash = new URLSearchParams(hash.replace(/^#/, ''))
  if (fromHash.has('code') || fromHash.has('error')) return fromHash
  return new URLSearchParams(search)
}

export function hasOAuthCallbackParams(): boolean {
  const params = readOAuthCallbackParams()
  return params.has('code') || params.has('error')
}

/** Configuration errors surface here; unavailable storage just means there's nothing to resume. */
export function hasStoredOAuthSession(): boolean {
  try {
    ensureConfigured()
    return listStoredSessions().length > 0
  } catch (err) {
    if (err instanceof AppError) throw err
    return false
  }
}

export async function finishOAuthSignIn(
  params: URLSearchParams,
  onSessionEnded?: SessionEndedCallback,
): Promise<{ session: OAuthSession; returnTo: string | null }> {
  ensureConfigured()
  const { session, state } = await finalizeAuthorization(params)
  const returnTo = safeReturnTo((state as { returnTo?: unknown } | null)?.returnTo)
  return { session: await toOAuthSession(new OAuthUserAgent(session), onSessionEnded), returnTo }
}

export async function resumeOAuthSession(onSessionEnded?: SessionEndedCallback): Promise<OAuthSession | null> {
  ensureConfigured()
  const stored = listStoredSessions()
  if (stored.length === 0) return null
  const did = stored[stored.length - 1]!
  let sessionPds: string | null = null
  try {
    // Note the issuing PDS before refreshing, so a revoked session can be checked for a migration.
    sessionPds = (await getSession(did, { allowStale: true })).info.aud
    return await toOAuthSession(new OAuthUserAgent(await getSession(did)), onSessionEnded)
  } catch (err) {
    // Keep credentials on transient failures so a reload can retry.
    if (!isDeadGrantError(err)) throw err
    deleteStoredSession(did)
    const notice = sessionPds ? await explainSessionEnd(did, sessionPds) : undefined
    throw new SessionEndedError(notice)
  }
}

export async function signOutOAuthSession(session: OAuthSession): Promise<void> {
  try {
    await session.userAgent.signOut()
  } finally {
    deleteStoredSession(session.did)
  }
}

export function clearStoredOAuthSessions(): void {
  // A rejected origin (e.g. localhost) never opened the OAuth store.
  if (configuredOrigin === null) return
  for (const did of listStoredSessions()) deleteStoredSession(did)
}

export function describeOAuthError(err: unknown): string {
  if (err instanceof SessionEndedError && err.notice) return err.notice
  return describeError(err).message
}

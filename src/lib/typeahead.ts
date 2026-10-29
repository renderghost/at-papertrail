/**
 * Account suggestions for the sign-in field (#90), from typeahead.waow.tech: a
 * community-run index of every atproto account, wherever it's hosted, with
 * Bluesky out of the request path. Its CORS is open, so the browser asks it
 * directly. Suggestions are only a convenience: when the service is slow,
 * rate-limited or down there are none, and typing a handle works as before.
 *
 * No X-Client header: a custom header would force a CORS preflight on every
 * request, and the service already identifies browser apps by their Origin.
 */
export const TYPEAHEAD_HOST = 'https://typeahead.waow.tech'
export const SUGGESTION_LIMIT = 6

export type ActorSuggestion = {
  did: string
  handle: string
  displayName?: string
  avatar?: string
  /** The same image from the account's own PDS, for when the CDN copy fails. */
  avatarFallback?: string
}

/** What to search for, or null when the text isn't worth a request: empty, a DID, or too long. */
export function typeaheadQuery(text: string): string | null {
  const q = text.trim().replace(/^@+/, '').toLowerCase()
  if (!q || q.startsWith('did:') || q.length > 64) return null
  return q
}

const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const https = (v: unknown): string | undefined => (typeof v === 'string' && v.startsWith('https://') ? v : undefined)

/** The usable accounts in a response, at most SUGGESTION_LIMIT, each once. */
export function parseSuggestions(body: unknown): ActorSuggestion[] {
  const actors = (body as { actors?: unknown } | null)?.actors
  if (!Array.isArray(actors)) return []
  const seen = new Set<string>()
  const out: ActorSuggestion[] = []
  for (const a of actors as Record<string, unknown>[]) {
    const did = text(a?.did)
    const handle = text(a?.handle)?.toLowerCase()
    if (!did?.startsWith('did:') || !handle || handle === 'handle.invalid' || !handle.includes('.') || seen.has(did)) continue
    seen.add(did)
    const suggestion: ActorSuggestion = { did, handle }
    const displayName = text(a.displayName)
    if (displayName) suggestion.displayName = displayName
    const avatar = https(a.avatar)
    if (avatar) suggestion.avatar = avatar
    const avatarFallback = https(a.avatarFallback)
    if (avatarFallback) suggestion.avatarFallback = avatarFallback
    out.push(suggestion)
    if (out.length === SUGGESTION_LIMIT) break
  }
  return out
}

export async function searchActors(query: string, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<ActorSuggestion[]> {
  const url = new URL('/xrpc/tech.waow.typeahead.searchActors', TYPEAHEAD_HOST)
  url.searchParams.set('q', query)
  url.searchParams.set('limit', String(SUGGESTION_LIMIT))
  const res = await fetchImpl(url.href, { signal })
  if (!res.ok) throw new Error(`Account suggestions are unavailable (HTTP ${res.status})`)
  return parseSuggestions(await res.json())
}

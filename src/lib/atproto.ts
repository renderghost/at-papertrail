/**
 * Unauthenticated AT Protocol reads. Everything here is public data: profiles
 * and follows from the Bluesky AppView, records straight from each user's PDS
 * (found via `resolvePds` in ./identity).
 */

const APPVIEW = 'https://public.api.bsky.app'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly error: string | undefined,
    message: string,
  ) {
    super(message)
  }
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } })
  if (!res.ok) {
    let body: { error?: string; message?: string } = {}
    try {
      body = await res.json()
    } catch {
      // Not JSON; the status is enough.
    }
    throw new HttpError(res.status, body.error, body.message ?? `${res.status} from ${new URL(url).host}`)
  }
  return res.json() as Promise<T>
}

export type RawRecord<T> = { uri: string; cid: string; value: T }

export function rkeyOf(uri: string): string {
  return uri.slice(uri.lastIndexOf('/') + 1)
}

/** Every record in a collection, newest first, up to `maxPages` × 100. */
export async function listAllRecords<T>(
  pds: string,
  did: string,
  collection: string,
  { maxPages = 50, signal }: { maxPages?: number; signal?: AbortSignal } = {},
): Promise<{ records: RawRecord<T>[]; complete: boolean }> {
  const records: RawRecord<T>[] = []
  let cursor: string | undefined
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ repo: did, collection, limit: '100' })
    if (cursor) params.set('cursor', cursor)
    let res: { records: RawRecord<T>[]; cursor?: string }
    try {
      res = await getJson(`${pds}/xrpc/com.atproto.repo.listRecords?${params}`, signal)
    } catch (err) {
      // A deactivated or missing repo has no books; anything else is a real failure.
      if (err instanceof HttpError && err.status === 400 && page === 0) {
        return { records, complete: true }
      }
      throw err
    }
    records.push(...res.records)
    if (!res.cursor || res.records.length === 0) return { records, complete: true }
    cursor = res.cursor
  }
  return { records, complete: false }
}

export async function getRecord<T>(
  pds: string,
  did: string,
  collection: string,
  rkey: string,
  signal?: AbortSignal,
): Promise<RawRecord<T> | null> {
  const params = new URLSearchParams({ repo: did, collection, rkey })
  try {
    return await getJson<RawRecord<T>>(`${pds}/xrpc/com.atproto.repo.getRecord?${params}`, signal)
  } catch (err) {
    if (err instanceof HttpError && (err.status === 404 || err.error === 'RecordNotFound')) return null
    throw err
  }
}

/** The repo's latest revision; it changes whenever any record in the repo does. */
export async function getLatestCommit(pds: string, did: string, signal?: AbortSignal): Promise<{ cid: string; rev: string }> {
  const params = new URLSearchParams({ did })
  return getJson(`${pds}/xrpc/com.atproto.sync.getLatestCommit?${params}`, signal)
}

export function blobUrl(pds: string, did: string, cid: string): string {
  const params = new URLSearchParams({ did, cid })
  return `${pds}/xrpc/com.atproto.sync.getBlob?${params}`
}

export type Profile = {
  did: string
  handle: string
  displayName?: string
  avatar?: string
}

function toProfile(p: Profile): Profile {
  return { did: p.did, handle: p.handle, displayName: p.displayName || undefined, avatar: p.avatar }
}

export async function getProfile(actor: string, signal?: AbortSignal): Promise<Profile> {
  const params = new URLSearchParams({ actor })
  return toProfile(await getJson<Profile>(`${APPVIEW}/xrpc/app.bsky.actor.getProfile?${params}`, signal))
}

/** Everyone `actor` follows, as listed by the Bluesky AppView. */
export async function getFollows(
  actor: string,
  { maxPages = 100, signal }: { maxPages?: number; signal?: AbortSignal } = {},
): Promise<Profile[]> {
  const follows: Profile[] = []
  let cursor: string | undefined
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ actor, limit: '100' })
    if (cursor) params.set('cursor', cursor)
    const res = await getJson<{ follows: Profile[]; cursor?: string }>(
      `${APPVIEW}/xrpc/app.bsky.graph.getFollows?${params}`,
      signal,
    )
    follows.push(...res.follows.map(toProfile))
    if (!res.cursor || res.follows.length === 0) break
    cursor = res.cursor
  }
  return follows
}

const RELAY = 'https://relay1.us-east.bsky.network'

/**
 * DIDs that have at least one record in `collection`, from the relay's
 * collection index. Returns null when the index can't be reached (it may not
 * allow cross-origin requests), so callers fall back to checking every repo.
 */
export async function listReposWithCollection(
  collection: string,
  { maxPages = 25, signal }: { maxPages?: number; signal?: AbortSignal } = {},
): Promise<Set<string> | null> {
  const dids = new Set<string>()
  let cursor: string | undefined
  try {
    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams({ collection, limit: '2000' })
      if (cursor) params.set('cursor', cursor)
      const res = await getJson<{ repos: { did: string }[]; cursor?: string }>(
        `${RELAY}/xrpc/com.atproto.sync.listReposByCollection?${params}`,
        signal,
      )
      for (const repo of res.repos) dids.add(repo.did)
      if (!res.cursor || res.repos.length === 0) return dids
      cursor = res.cursor
    }
    // Ran out of pages: the set is partial, so it can't be used as a filter.
    return null
  } catch (err) {
    if (signal?.aborted) throw err
    return null
  }
}

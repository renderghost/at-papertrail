import { useEffect, useSyncExternalStore } from 'react'
import { getFollows, getLatestCommit, listReposWithCollection, type Profile } from './atproto'
import { loadLibrary } from './bookhive/library'
import { BOOK_COLLECTION, type BookEntry } from './bookhive/types'
import { indexedDbStore, type KeyValueStore } from './cache'
import { forgetPds, rememberPds, resolvePds } from './identity'
import { createLimiter } from './pool'
import { loadBookReviews, POPFEED_REVIEW, type ReviewEntry } from './popfeed'

/**
 * Your network's books, read straight from each follow's PDS: their BookHive
 * libraries and their PopFeed book reviews. There is no server: the scan runs
 * in the browser and results stream in as each repo answers.
 *
 * Fast on a big follow graph (#5):
 * - the relay's collection index narrows the scan to follows who use BookHive
 *   or PopFeed at all;
 * - the last scan is kept in IndexedDB (public data only), so a reload shows
 *   your network at once while it refreshes in the background;
 * - a repo whose latest commit hasn't changed since the last scan isn't
 *   re-read.
 */

export type Reader = { profile: Profile; books: BookEntry[]; reviews: ReviewEntry[] }

export type NetworkState = {
  status: 'idle' | 'loading' | 'done' | 'error'
  error?: string
  /** How many accounts you follow. */
  followCount: number
  /** Repos being checked: follows known to use BookHive or PopFeed, or all follows. */
  toScan: number
  scanned: number
  failed: number
  /** True when the relay's collection index narrowed the scan. */
  usedIndex: boolean
  /** Follows with at least one book or book review. */
  readers: Reader[]
  loadedAt?: number
  /** Set while the readers shown come from the stored copy of an earlier scan. */
  cachedAt?: number
}

const EMPTY: NetworkState = {
  status: 'idle',
  followCount: 0,
  toScan: 0,
  scanned: 0,
  failed: 0,
  usedIndex: false,
  readers: [],
}

const FRESH_FOR_MS = 15 * 60 * 1000
const CACHE_PREFIX = 'network:'
const CACHE_VERSION = 1

type CachedRepo = { rev: string | null; pds: string; books: BookEntry[]; reviews: ReviewEntry[] }
type CachedNetwork = {
  version: number
  savedAt: number
  followCount: number
  usedIndex: boolean
  profiles: Record<string, Profile>
  repos: Record<string, CachedRepo>
}

export type NetworkDeps = {
  getFollows: typeof getFollows
  listReposWithCollection: typeof listReposWithCollection
  resolvePds: (did: string) => Promise<string>
  latestRev: (pds: string, did: string, signal?: AbortSignal) => Promise<string>
  loadBooks: (did: string, signal: AbortSignal) => Promise<BookEntry[]>
  loadReviews: (did: string, signal: AbortSignal) => Promise<ReviewEntry[]>
  rememberPds: (did: string, pds: string) => void
  forgetPds: (did: string) => void
  cache: KeyValueStore
  now: () => number
}

const defaultDeps = (): NetworkDeps => ({
  getFollows,
  listReposWithCollection,
  resolvePds,
  latestRev: async (pds, did, signal) => (await getLatestCommit(pds, did, signal)).rev,
  loadBooks: async (did, signal) => (await loadLibrary(did, { maxPages: 20, signal })).entries,
  loadReviews: (did, signal) => loadBookReviews(did, { maxPages: 10, signal }),
  rememberPds,
  forgetPds,
  cache: indexedDbStore(),
  now: Date.now,
})

function readersFrom(cached: CachedNetwork): Reader[] {
  const readers: Reader[] = []
  for (const [did, repo] of Object.entries(cached.repos)) {
    const profile = cached.profiles[did]
    if (profile && (repo.books.length > 0 || repo.reviews.length > 0)) {
      readers.push({ profile, books: repo.books, reviews: repo.reviews })
    }
  }
  return readers
}

export class NetworkStore {
  private state: NetworkState = EMPTY
  private listeners = new Set<() => void>()
  private controller: AbortController | null = null
  private did: string | null = null
  private emitTimer: ReturnType<typeof setTimeout> | null = null
  private deps: NetworkDeps | null

  constructor(deps?: NetworkDeps) {
    this.deps = deps ?? null
  }

  private get d(): NetworkDeps {
    return (this.deps ??= defaultDeps())
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.state

  private set(patch: Partial<NetworkState>, { immediate = false } = {}) {
    this.state = { ...this.state, ...patch }
    if (immediate) {
      if (this.emitTimer) clearTimeout(this.emitTimer)
      this.emitTimer = null
      this.listeners.forEach((l) => l())
    } else if (!this.emitTimer) {
      // Batch the flood of per-repo updates into a few renders a second.
      this.emitTimer = setTimeout(() => {
        this.emitTimer = null
        this.listeners.forEach((l) => l())
      }, 150)
    }
  }

  load(did: string, { force = false } = {}) {
    const { status, loadedAt } = this.state
    const sameUser = this.did === did
    if (sameUser && !force) {
      if (status === 'loading') return
      if (status === 'done' && loadedAt && this.d.now() - loadedAt < FRESH_FOR_MS) return
    }
    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    this.did = did
    // Keep showing the previous results for this user while refreshing.
    this.set({ ...EMPTY, status: 'loading', readers: sameUser ? this.state.readers : [] }, { immediate: true })
    this.run(did, controller.signal).catch((err: unknown) => {
      if (controller.signal.aborted) return
      this.set({ status: 'error', error: err instanceof Error ? err.message : String(err) }, { immediate: true })
    })
  }

  /** Forgets everything, including the stored copies (on sign-out). */
  reset() {
    this.controller?.abort()
    this.did = null
    this.set(EMPTY, { immediate: true })
    void this.d.cache.clearPrefix(CACHE_PREFIX)
  }

  private async readCache(did: string): Promise<CachedNetwork | null> {
    const cached = await this.d.cache.get<CachedNetwork>(CACHE_PREFIX + did).catch(() => undefined)
    return cached && cached.version === CACHE_VERSION ? cached : null
  }

  private async run(did: string, signal: AbortSignal) {
    const d = this.d
    const cached = await this.readCache(did)
    if (signal.aborted) return
    if (cached && this.state.readers.length === 0) {
      this.set(
        { readers: readersFrom(cached), cachedAt: cached.savedAt, followCount: cached.followCount, usedIndex: cached.usedIndex },
        { immediate: true },
      )
    }

    const follows = await d.getFollows(did, { signal })
    this.set({ followCount: follows.length })

    const [bookIndex, reviewIndex] = await Promise.all([
      d.listReposWithCollection(BOOK_COLLECTION, { signal }),
      d.listReposWithCollection(POPFEED_REVIEW, { signal }),
    ])
    // Without the book index, every follow is checked for books (but not for PopFeed reviews).
    const usedIndex = !!bookIndex
    const hasBooks = (f: Profile) => !bookIndex || bookIndex.has(f.did)
    const hasReviews = (f: Profile) => !!reviewIndex?.has(f.did)
    const targets = follows.filter((f) => hasBooks(f) || hasReviews(f))
    this.set({ toScan: targets.length, usedIndex }, { immediate: true })

    const repos: Record<string, CachedRepo> = {}
    const profiles: Record<string, Profile> = {}
    const readers: Reader[] = []
    let scanned = 0
    let failed = 0
    // On a refresh (or from cache), keep the old results on screen until the new set is complete.
    const streamResults = this.state.readers.length === 0
    const limit = createLimiter(8)

    const revFor = async (target: string, hint: string | undefined): Promise<{ pds: string; rev: string | null }> => {
      if (hint) {
        d.rememberPds(target, hint)
        const rev = await d.latestRev(hint, target, signal).catch(() => null)
        if (rev) return { pds: hint, rev }
        // The stored PDS may be stale (the account moved); resolve afresh.
        d.forgetPds(target)
      }
      const pds = await d.resolvePds(target)
      return { pds, rev: await d.latestRev(pds, target, signal).catch(() => null) }
    }

    await Promise.all(
      targets.map((profile) =>
        limit(async () => {
          if (signal.aborted) return
          const before = cached?.repos[profile.did]
          try {
            const { pds, rev } = await revFor(profile.did, before?.pds)
            let repo: CachedRepo
            if (before && rev && before.rev === rev) {
              repo = before
            } else {
              const [books, reviews] = await Promise.all([
                hasBooks(profile) ? d.loadBooks(profile.did, signal) : Promise.resolve([]),
                hasReviews(profile) ? d.loadReviews(profile.did, signal) : Promise.resolve([]),
              ])
              repo = { rev, pds, books, reviews }
            }
            repos[profile.did] = repo
            profiles[profile.did] = profile
            if (repo.books.length > 0 || repo.reviews.length > 0) {
              readers.push({ profile, books: repo.books, reviews: repo.reviews })
            }
          } catch {
            if (signal.aborted) return
            failed++
          }
          scanned++
          this.set(streamResults ? { scanned, failed, readers: [...readers] } : { scanned, failed })
        }),
      ),
    )
    if (signal.aborted) return
    const loadedAt = d.now()
    this.set({ status: 'done', readers: [...readers], scanned, failed, loadedAt, cachedAt: undefined }, { immediate: true })
    const next: CachedNetwork = { version: CACHE_VERSION, savedAt: loadedAt, followCount: follows.length, usedIndex, profiles, repos }
    await d.cache.set(CACHE_PREFIX + did, next).catch(() => undefined)
  }
}

export const networkStore = new NetworkStore()

/** Starts (or reuses) the scan of `did`'s follows and subscribes to its progress. */
export function useNetwork(did: string | undefined): NetworkState & { refresh: () => void } {
  const state = useSyncExternalStore(networkStore.subscribe, networkStore.getSnapshot)
  useEffect(() => {
    if (did) networkStore.load(did)
  }, [did])
  return { ...state, refresh: () => did && networkStore.load(did, { force: true }) }
}

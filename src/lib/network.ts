import { useEffect, useSyncExternalStore } from 'react'
import { getFollows, listReposWithCollection, type Profile } from './atproto'
import { loadLibrary } from './bookhive/library'
import { BOOK_COLLECTION, type BookEntry } from './bookhive/types'
import { createLimiter } from './pool'

/**
 * Your network's BookHive libraries, read straight from each follow's PDS.
 * There is no server: the scan runs in the browser, results stream in as each
 * repo answers, and they're kept in memory until the tab closes.
 */

export type Reader = { profile: Profile; books: BookEntry[] }

export type NetworkState = {
  status: 'idle' | 'loading' | 'done' | 'error'
  error?: string
  /** How many accounts you follow. */
  followCount: number
  /** Repos being checked: follows known to use BookHive, or all follows. */
  toScan: number
  scanned: number
  failed: number
  /** True when the relay's collection index narrowed the scan. */
  usedIndex: boolean
  /** Follows with at least one book. */
  readers: Reader[]
  loadedAt?: number
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

class NetworkStore {
  private state: NetworkState = EMPTY
  private listeners = new Set<() => void>()
  private controller: AbortController | null = null
  private did: string | null = null
  private emitTimer: ReturnType<typeof setTimeout> | null = null

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
      if (status === 'done' && loadedAt && Date.now() - loadedAt < FRESH_FOR_MS) return
    }
    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    this.did = did
    // Keep showing the previous results for this user while refreshing.
    this.set(
      { ...EMPTY, status: 'loading', readers: sameUser ? this.state.readers : [] },
      { immediate: true },
    )
    this.run(did, controller.signal).catch((err: unknown) => {
      if (controller.signal.aborted) return
      this.set({ status: 'error', error: err instanceof Error ? err.message : String(err) }, { immediate: true })
    })
  }

  reset() {
    this.controller?.abort()
    this.did = null
    this.set(EMPTY, { immediate: true })
  }

  private async run(did: string, signal: AbortSignal) {
    const follows = await getFollows(did, { signal })
    this.set({ followCount: follows.length })

    let targets = follows
    let usedIndex = false
    const index = await listReposWithCollection(BOOK_COLLECTION, { signal })
    if (index) {
      const filtered = follows.filter((f) => index.has(f.did))
      if (filtered.length > 0) {
        targets = filtered
        usedIndex = true
      }
    }
    this.set({ toScan: targets.length, usedIndex }, { immediate: true })

    const readers: Reader[] = []
    let scanned = 0
    let failed = 0
    // On a refresh, keep the old results on screen until the new set is complete.
    const streamResults = this.state.readers.length === 0
    const limit = createLimiter(8)
    await Promise.all(
      targets.map((profile) =>
        limit(async () => {
          if (signal.aborted) return
          try {
            const { entries } = await loadLibrary(profile.did, { maxPages: 20, signal })
            if (entries.length > 0) readers.push({ profile, books: entries })
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
    this.set({ status: 'done', readers: [...readers], scanned, failed, loadedAt: Date.now() }, { immediate: true })
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

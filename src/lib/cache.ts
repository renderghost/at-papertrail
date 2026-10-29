/**
 * A small key-value cache in IndexedDB, for disposable copies of public data
 * (e.g. the libraries of people you follow). Nothing here is the source of
 * truth: it can be cleared at any time, and the app works without it. When
 * IndexedDB is unavailable (private browsing, tests) it falls back to memory.
 */

export type KeyValueStore = {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  /** Removes every key starting with `prefix`. */
  clearPrefix(prefix: string): Promise<void>
}

export function memoryStore(): KeyValueStore {
  const map = new Map<string, unknown>()
  return {
    get: async <T,>(key: string) => map.get(key) as T | undefined,
    set: async (key, value) => void map.set(key, value),
    delete: async (key) => void map.delete(key),
    clearPrefix: async (prefix) => {
      for (const key of [...map.keys()]) if (key.startsWith(prefix)) map.delete(key)
    },
  }
}

const DB_NAME = 'papertrail'
const STORE = 'cache'

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export function indexedDbStore(): KeyValueStore {
  if (typeof indexedDB === 'undefined') return memoryStore()
  let opened: Promise<IDBDatabase> | null = null
  const db = () => {
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
      req.onblocked = () => reject(new Error('IndexedDB is blocked'))
    })
    opened.catch(() => (opened = null))
    return opened
  }
  const store = async (mode: IDBTransactionMode) => (await db()).transaction(STORE, mode).objectStore(STORE)
  const fallback = memoryStore()
  // A failing IndexedDB (quota, private mode) degrades to memory rather than breaking the app.
  return {
    get: async <T,>(key: string) => {
      try {
        return (await request((await store('readonly')).get(key))) as T | undefined
      } catch {
        return fallback.get<T>(key)
      }
    },
    set: async (key, value) => {
      try {
        await request((await store('readwrite')).put(value, key))
      } catch {
        await fallback.set(key, value)
      }
    },
    delete: async (key) => {
      await fallback.delete(key)
      try {
        await request((await store('readwrite')).delete(key))
      } catch {
        // Nothing stored, or nothing to delete.
      }
    },
    clearPrefix: async (prefix) => {
      await fallback.clearPrefix(prefix)
      try {
        const s = await store('readwrite')
        const keys = await request(s.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}￿`)))
        await Promise.all(keys.map((k) => request(s.delete(k))))
      } catch {
        // Nothing stored.
      }
    },
  }
}

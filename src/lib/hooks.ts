import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { getProfile } from './atproto'
import { useSession } from './auth'
import { fetchCatalogBook } from './bookhive/catalog'
import { createBook, deleteBook, loadLibrary, updateBook } from './bookhive/library'
import type { BookEntry, BookRecord } from './bookhive/types'

const HOUR = 60 * 60 * 1000

export function useCatalog(hiveId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['catalog', hiveId],
    queryFn: () => fetchCatalogBook(hiveId!),
    enabled: !!hiveId && enabled,
    staleTime: 6 * HOUR,
    gcTime: 6 * HOUR,
  })
}

export function useProfile(actor: string | undefined) {
  return useQuery({
    queryKey: ['profile', actor],
    queryFn: () => getProfile(actor!),
    enabled: !!actor,
    staleTime: HOUR,
  })
}

export function useLibrary(did: string | undefined) {
  return useQuery({
    queryKey: ['library', did],
    queryFn: async () => (await loadLibrary(did!)).entries,
    enabled: !!did,
    staleTime: 60 * 1000,
  })
}

export function useMyLibrary() {
  const { did } = useSession()
  return useLibrary(did)
}

/** Create, update and delete the signed-in user's book records, keeping the cache in step. */
export function useBookWrites() {
  const { did, session } = useSession()
  const queryClient = useQueryClient()
  const key = ['library', did]

  const replace = (fn: (entries: BookEntry[]) => BookEntry[]) =>
    queryClient.setQueryData<BookEntry[]>(key, (entries) => fn(entries ?? []))

  const create = useMutation({
    mutationFn: (record: BookRecord) => createBook(session, record),
    onSuccess: (entry) => replace((entries) => [entry, ...entries]),
  })

  const update = useMutation({
    mutationFn: ({ entry, next }: { entry: BookEntry; next: BookRecord }) => updateBook(session, entry, next),
    onSuccess: (entry) => replace((entries) => entries.map((e) => (e.uri === entry.uri ? entry : e))),
    // A stale write means our copy is out of date; fetch the latest.
    onError: () => queryClient.invalidateQueries({ queryKey: key }),
  })

  const remove = useMutation({
    mutationFn: (entry: BookEntry) => deleteBook(session, entry),
    onSuccess: (_, entry) => replace((entries) => entries.filter((e) => e.uri !== entry.uri)),
    onError: () => queryClient.invalidateQueries({ queryKey: key }),
  })

  return { create, update, remove }
}

/** True once the element has been near the viewport; used to lazy-load covers. */
export function useInView<T extends Element>(rootMargin = '300px') {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || inView) return
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true)
          observer.disconnect()
        }
      },
      { rootMargin },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [inView, rootMargin])
  return { ref, inView }
}

export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

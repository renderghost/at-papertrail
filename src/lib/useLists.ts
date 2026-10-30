import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useMaybeSession, useSession } from './auth'
import {
  addToList,
  createList,
  deleteList,
  itemIsBook,
  loadLists,
  NOT_INTERESTED_LIST,
  notInterestedIds,
  notInterestedList,
  removeFromList,
  reorderList,
  updateItemNote,
  updateList,
  type BookList,
  type ListBook,
  type ListItem,
  type ListRecord,
} from './lists'

/** Someone's book lists, from their PDS. */
export function useLists(did: string | undefined) {
  return useQuery({
    queryKey: ['lists', did],
    queryFn: ({ signal }) => loadLists(did!, signal),
    enabled: !!did,
    staleTime: 60 * 1000,
  })
}

/** Writes to the signed-in reader's own lists, keeping the cache in step. */
export function useListWrites() {
  const { did, session } = useSession()
  const queryClient = useQueryClient()
  const key = ['lists', did]
  const put = (list: BookList) =>
    queryClient.setQueryData<BookList[]>(key, (lists) => {
      const all = lists ?? []
      return all.some((l) => l.uri === list.uri) ? all.map((l) => (l.uri === list.uri ? list : l)) : [list, ...all]
    })
  // A stale write means our copy is out of date: fetch the latest.
  const onError = () => queryClient.invalidateQueries({ queryKey: key })

  return {
    create: useMutation({
      mutationFn: (input: { name: string; description?: string; ordered?: boolean; tags?: string[] }) => createList(session, input),
      onSuccess: put,
    }),
    update: useMutation({
      mutationFn: ({ list, patch }: { list: BookList; patch: Partial<ListRecord> }) => updateList(session, list, patch),
      onSuccess: put,
      onError,
    }),
    remove: useMutation({
      mutationFn: (list: BookList) => deleteList(session, list),
      onSuccess: (_, list) => queryClient.setQueryData<BookList[]>(key, (lists) => (lists ?? []).filter((l) => l.uri !== list.uri)),
      onError,
    }),
    add: useMutation({
      mutationFn: ({ list, book, note }: { list: BookList; book: ListBook; note?: string }) => addToList(session, list, book, note),
      onSuccess: put,
      onError,
    }),
    removeItem: useMutation({
      mutationFn: ({ list, item }: { list: BookList; item: ListItem }) => removeFromList(session, list, item),
      onSuccess: put,
      onError,
    }),
    reorder: useMutation({
      mutationFn: ({ list, uris }: { list: BookList; uris: string[] }) => reorderList(session, list, uris),
      onSuccess: put,
      onError,
    }),
    note: useMutation({
      mutationFn: ({ list, item, note }: { list: BookList; item: ListItem; note: string }) => updateItemNote(session, list, item, note),
      onSuccess: put,
      onError,
    }),
  }
}

// One Not Interested list per reader, even when two cards ask for it at once.
const creating = new Map<string, Promise<BookList>>()

/**
 * Your Not Interested list (#106): which books are on it, and marking or
 * unmarking one. It's made the first time you use it. Writes read the
 * latest copy of your lists, so an Undo straight after a change still finds
 * what that change added.
 */
export function useNotInterested() {
  const { did } = useSession()
  const queryClient = useQueryClient()
  const lists = useLists(did)
  const writes = useListWrites()
  const list = notInterestedList(lists.data ?? [])
  const latest = async () =>
    notInterestedList(await queryClient.ensureQueryData({ queryKey: ['lists', did], queryFn: ({ signal }) => loadLists(did, signal) }))

  return {
    list,
    has: (book: { hiveId: string; identifiers?: ListBook['identifiers'] }) => !!list?.items.some((i) => itemIsBook(i, book)),
    mark: async (book: ListBook) => {
      let target = await latest()
      if (target?.items.some((i) => itemIsBook(i, book))) return
      if (!target) {
        const pending = creating.get(did) ?? writes.create.mutateAsync(NOT_INTERESTED_LIST)
        creating.set(did, pending)
        try {
          target = await pending
        } finally {
          creating.delete(did)
        }
      }
      await writes.add.mutateAsync({ list: target, book })
    },
    unmark: async (book: ListBook) => {
      const target = await latest()
      const item = target?.items.find((i) => itemIsBook(i, book))
      if (target && item) await writes.removeItem.mutateAsync({ list: target, item })
    },
  }
}

/** The hiveIds you've marked Not Interested; none when signed out. */
export function useNotInterestedIds(): string[] {
  const me = useMaybeSession()
  const lists = useLists(me?.did)
  return useMemo(() => notInterestedIds(notInterestedList(lists.data ?? [])), [lists.data])
}

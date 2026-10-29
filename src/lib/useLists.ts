import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from './auth'
import {
  addToList,
  createList,
  deleteList,
  loadLists,
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

import { listAllRecords, rkeyOf, type RawRecord } from './atproto'
import { firstAuthor } from './bookhive/authors'
import type { BookIdentifiers } from './bookhive/types'
import { StaleRecordError } from './errors'
import { resolvePds } from './identity'
import { nextTid } from './tid'
import { procedure, XrpcError, type SessionFetch } from './xrpc'

/**
 * Lists and shelves, stored as PopFeed lists exactly as BookHive writes them
 * (`src/services/lists.ts` upstream), so a list made here shows on
 * bookhive.buzz and in PopFeed, and the other way round.
 */

export const LIST = 'social.popfeed.feed.list'
export const LIST_ITEM = 'social.popfeed.feed.listItem'

export type ListRecord = {
  $type?: typeof LIST
  name: string
  description?: string
  tags?: string[]
  /** Set by PopFeed for its own shelves, e.g. "read_books"; absent on custom lists. */
  listType?: string
  createdAt: string
  ordered?: boolean
  /** Item URIs in display order, kept on the list so reordering touches one record. */
  itemOrder?: string[]
  [key: string]: unknown
}

export type ListItemRecord = {
  $type?: typeof LIST_ITEM
  identifiers: BookIdentifiers & { asin?: string; [key: string]: unknown }
  creativeWorkType: string
  listUri: string
  addedAt: string
  title?: string
  mainCredit?: string
  mainCreditRole?: string
  posterUrl?: string
  genres?: string[]
  /** A note on why the book is on the list. */
  description?: string
  /** Deprecated by PopFeed, but still the first sort key on bookhive.buzz. */
  position?: number
  [key: string]: unknown
}

export type ListItem = { uri: string; cid: string; rkey: string; value: ListItemRecord }

export type BookList = {
  uri: string
  cid: string
  rkey: string
  did: string
  value: ListRecord
  /** Book items only, in display order. */
  items: ListItem[]
}

/** PopFeed's own reading shelves; PopFeed keeps them in step with its statuses, so they're read-only here. */
export function isPopfeedShelf(list: Pick<BookList, 'value'>): boolean {
  return /_books$/.test(list.value.listType ?? '')
}

/**
 * bookhive.buzz's order: by `position`, newest first, then URI; an ordered list
 * with an `itemOrder` puts those items first, in that order.
 */
export function orderItems(list: ListRecord, items: ListItem[]): ListItem[] {
  const fallback = [...items].sort((a, b) => {
    const pa = a.value.position ?? Number.POSITIVE_INFINITY
    const pb = b.value.position ?? Number.POSITIVE_INFINITY
    if (pa !== pb) return pa - pb
    if (a.value.addedAt !== b.value.addedAt) return a.value.addedAt < b.value.addedAt ? 1 : -1
    return a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0
  })
  if (!list.ordered || !Array.isArray(list.itemOrder)) return fallback
  const ranks = new Map(list.itemOrder.map((uri, i) => [uri, i]))
  return fallback
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (ranks.get(a.item.uri) ?? Infinity) - (ranks.get(b.item.uri) ?? Infinity) || a.i - b.i)
    .map((x) => x.item)
}

function isList(value: unknown): value is ListRecord {
  const v = value as ListRecord | null
  return !!v && typeof v.name === 'string' && typeof v.createdAt === 'string'
}

function isBookItem(value: unknown): value is ListItemRecord {
  const v = value as ListItemRecord | null
  return (
    !!v &&
    v.creativeWorkType === 'book' &&
    typeof v.listUri === 'string' &&
    v.listUri.startsWith('at://') &&
    typeof v.addedAt === 'string' &&
    !!v.identifiers &&
    typeof v.identifiers === 'object'
  )
}

/** Builds lists from raw records: book items grouped under their list, films and games left out. */
export function buildLists(did: string, lists: RawRecord<unknown>[], items: RawRecord<unknown>[]): BookList[] {
  const byList = new Map<string, ListItem[]>()
  const nonBook = new Set<string>()
  for (const r of items) {
    const listUri = (r.value as { listUri?: unknown } | null)?.listUri
    if (!isBookItem(r.value)) {
      if (typeof listUri === 'string') nonBook.add(listUri)
      continue
    }
    const entry: ListItem = { uri: r.uri, cid: r.cid, rkey: rkeyOf(r.uri), value: r.value }
    byList.set(r.value.listUri, [...(byList.get(r.value.listUri) ?? []), entry])
  }
  return lists
    .filter((r): r is RawRecord<ListRecord> => isList(r.value))
    .map((r) => ({
      uri: r.uri,
      cid: r.cid,
      rkey: rkeyOf(r.uri),
      did,
      value: r.value,
      items: orderItems(r.value, byList.get(r.uri) ?? []),
    }))
    .filter((l) => {
      // A watchlist of films isn't a book list; an empty list may become one.
      if (l.items.length > 0) return true
      if (nonBook.has(l.uri)) return false
      const type = l.value.listType
      return !type || /book/.test(type)
    })
    .sort((a, b) => (a.value.createdAt < b.value.createdAt ? 1 : -1))
}

/** Someone's book lists, read straight from their PDS. */
export async function loadLists(did: string, signal?: AbortSignal): Promise<BookList[]> {
  const pds = await resolvePds(did)
  const [lists, items] = await Promise.all([
    listAllRecords<unknown>(pds, did, LIST, { maxPages: 10, signal }),
    listAllRecords<unknown>(pds, did, LIST_ITEM, { maxPages: 50, signal }),
  ])
  return buildLists(did, lists.records, items.records)
}

/** The book a list item stands for, in the shape BookHive writes. */
export type ListBook = {
  hiveId: string
  title: string
  /** Tab-separated, as in `buzz.bookhive.book`. */
  authors: string
  identifiers?: BookIdentifiers
  coverUrl?: string
  genres?: string[]
}

export function newListItem(listUri: string, book: ListBook, note?: string, now = () => new Date().toISOString()): ListItemRecord {
  const identifiers: ListItemRecord['identifiers'] = { hiveId: book.hiveId }
  if (book.identifiers?.isbn10) identifiers.isbn10 = book.identifiers.isbn10
  if (book.identifiers?.isbn13) identifiers.isbn13 = book.identifiers.isbn13
  return {
    $type: LIST_ITEM,
    creativeWorkType: 'book',
    identifiers,
    title: book.title,
    mainCredit: firstAuthor(book.authors),
    mainCreditRole: 'author',
    ...(book.coverUrl?.startsWith('https://') ? { posterUrl: book.coverUrl } : {}),
    ...(book.genres?.length ? { genres: book.genres.slice(0, 10) } : {}),
    listUri,
    addedAt: now(),
    ...(note?.trim() ? { description: note.trim().slice(0, 5000) } : {}),
  }
}

/** Whether an item is this book: by hiveId, else by ISBN. */
export function itemIsBook(item: ListItem, book: { hiveId: string; identifiers?: BookIdentifiers }): boolean {
  const ids = item.value.identifiers
  if (ids.hiveId) return ids.hiveId === book.hiveId
  return (!!ids.isbn13 && ids.isbn13 === book.identifiers?.isbn13) || (!!ids.isbn10 && ids.isbn10 === book.identifiers?.isbn10)
}

type Write =
  | { $type: 'com.atproto.repo.applyWrites#create'; collection: string; rkey: string; value: unknown }
  | { $type: 'com.atproto.repo.applyWrites#update'; collection: string; rkey: string; value: unknown }
  | { $type: 'com.atproto.repo.applyWrites#delete'; collection: string; rkey: string }

type WriteResult = { uri: string; cid: string }

async function applyWrites(session: SessionFetch, writes: Write[]): Promise<{ results?: (WriteResult | object)[] }> {
  let last: { results?: (WriteResult | object)[] } = {}
  // The PDS accepts at most 200 writes per call.
  for (let i = 0; i < writes.length; i += 200) {
    last = await procedure(session, 'com.atproto.repo.applyWrites', { repo: session.did, writes: writes.slice(i, i + 200) })
  }
  return last
}

function staleOr(err: unknown): never {
  if (err instanceof XrpcError && err.error === 'InvalidSwap') throw new StaleRecordError()
  throw err
}

function uriFor(did: string, collection: string, rkey: string): string {
  return `at://${did}/${collection}/${rkey}`
}

export async function createList(
  session: SessionFetch,
  input: { name: string; description?: string; ordered?: boolean },
  now = () => new Date().toISOString(),
): Promise<BookList> {
  const value: ListRecord = {
    $type: LIST,
    name: input.name.trim().slice(0, 100),
    ...(input.description?.trim() ? { description: input.description.trim().slice(0, 500) } : {}),
    ordered: input.ordered ?? false,
    tags: [],
    createdAt: now(),
  }
  const res = await procedure<WriteResult>(session, 'com.atproto.repo.createRecord', {
    repo: session.did,
    collection: LIST,
    record: value,
  })
  return { uri: res.uri, cid: res.cid, rkey: rkeyOf(res.uri), did: session.did, value, items: [] }
}

/** Compare-and-swap update of the list record; fields this app doesn't know are kept. */
export async function updateList(session: SessionFetch, list: BookList, patch: Partial<ListRecord>): Promise<BookList> {
  const value: ListRecord = { ...list.value, ...patch, $type: LIST }
  if (value.description === '') delete value.description
  try {
    const res = await procedure<WriteResult>(session, 'com.atproto.repo.putRecord', {
      repo: session.did,
      collection: LIST,
      rkey: list.rkey,
      record: value,
      swapRecord: list.cid,
    })
    return { ...list, cid: res.cid, value, items: orderItems(value, list.items) }
  } catch (err) {
    return staleOr(err)
  }
}

/** Deletes the list and every item in it (as bookhive.buzz does). */
export async function deleteList(session: SessionFetch, list: BookList): Promise<void> {
  await applyWrites(session, [
    ...list.items.map((item): Write => ({ $type: 'com.atproto.repo.applyWrites#delete', collection: LIST_ITEM, rkey: item.rkey })),
    { $type: 'com.atproto.repo.applyWrites#delete', collection: LIST, rkey: list.rkey },
  ])
}

/**
 * Adds a book. On an ordered list it goes to the end: the item and the list's
 * new `itemOrder` are written together, so the order never lists a missing item.
 */
export async function addToList(session: SessionFetch, list: BookList, book: ListBook, note?: string): Promise<BookList> {
  const rkey = nextTid()
  const item: ListItem = { uri: uriFor(session.did, LIST_ITEM, rkey), cid: '', rkey, value: newListItem(list.uri, book, note) }
  const writes: Write[] = [{ $type: 'com.atproto.repo.applyWrites#create', collection: LIST_ITEM, rkey, value: item.value }]
  let value = list.value
  if (list.value.ordered) {
    value = { ...list.value, $type: LIST, itemOrder: [...list.items.map((i) => i.uri), item.uri] }
    writes.push({ $type: 'com.atproto.repo.applyWrites#update', collection: LIST, rkey: list.rkey, value })
  }
  const res = await applyWrites(session, writes)
  const [created, updated] = (res.results ?? []) as WriteResult[]
  const items = [...list.items, { ...item, cid: created?.cid ?? '' }]
  return { ...list, cid: updated?.cid ?? list.cid, value, items: orderItems(value, items) }
}

export async function removeFromList(session: SessionFetch, list: BookList, item: ListItem): Promise<BookList> {
  const writes: Write[] = [{ $type: 'com.atproto.repo.applyWrites#delete', collection: LIST_ITEM, rkey: item.rkey }]
  let value = list.value
  if (Array.isArray(list.value.itemOrder) && list.value.itemOrder.includes(item.uri)) {
    value = { ...list.value, $type: LIST, itemOrder: list.value.itemOrder.filter((u) => u !== item.uri) }
    writes.push({ $type: 'com.atproto.repo.applyWrites#update', collection: LIST, rkey: list.rkey, value })
  }
  const res = await applyWrites(session, writes)
  const updated = (res.results ?? [])[1] as WriteResult | undefined
  return { ...list, cid: updated?.cid ?? list.cid, value, items: list.items.filter((i) => i.uri !== item.uri) }
}

/** Saves a new order (and makes the list ordered). */
export function reorderList(session: SessionFetch, list: BookList, uris: string[]): Promise<BookList> {
  return updateList(session, list, { ordered: true, itemOrder: uris })
}

export async function updateItemNote(session: SessionFetch, list: BookList, item: ListItem, note: string): Promise<BookList> {
  const value: ListItemRecord = { ...item.value, $type: LIST_ITEM }
  if (note.trim()) value.description = note.trim().slice(0, 5000)
  else delete value.description
  try {
    const res = await procedure<WriteResult>(session, 'com.atproto.repo.putRecord', {
      repo: session.did,
      collection: LIST_ITEM,
      rkey: item.rkey,
      record: value,
      swapRecord: item.cid || undefined,
    })
    const next = { ...item, cid: res.cid, value }
    return { ...list, items: list.items.map((i) => (i.uri === item.uri ? next : i)) }
  } catch (err) {
    return staleOr(err)
  }
}

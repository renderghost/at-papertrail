import { applyPatch } from './bookhive/library'
import { nextReadingState } from './bookhive/lifecycle'
import { BOOK_COLLECTION, type BookEntry, type BookRecord, type BookStatus } from './bookhive/types'
import { itemIsBook, LIST, LIST_ITEM, newListItem, type BookList } from './lists'
import { nextTid } from './tid'
import type { Write } from './xrpc'

/**
 * Select mode on shelves (#100): one change to many books at once, written in
 * a single applyWrites call, with the writes that undo it.
 */

export type BatchChange =
  | { kind: 'status'; status: BookStatus }
  | { kind: 'owned'; owned: boolean }
  | { kind: 'list'; list: BookList }
  | { kind: 'remove' }

export type BatchPlan = {
  writes: Write[]
  /** Puts every record back as it was. */
  undo: Write[]
  /** Books the change applies to (the rest already had it). */
  changed: number
}

const update = (collection: string, rkey: string, value: unknown): Write => ({ $type: 'com.atproto.repo.applyWrites#update', collection, rkey, value })
const create = (collection: string, rkey: string, value: unknown): Write => ({ $type: 'com.atproto.repo.applyWrites#create', collection, rkey, value })
const remove = (collection: string, rkey: string): Write => ({ $type: 'com.atproto.repo.applyWrites#delete', collection, rkey })

/** A book record moved to `status`, dates stamped as the book page would: a book entering a status gets today, a re-read keeps the last read. */
export function withStatus(value: BookRecord, status: BookStatus, now: () => string = () => new Date().toISOString()): BookRecord {
  const state = nextReadingState(
    { status: value.status ?? null, startedAt: value.startedAt ?? null, finishedAt: value.finishedAt ?? null, previousReads: value.previousReads ?? null },
    { status },
    { now },
  )
  return applyPatch(value, state)
}

export function planBatch(entries: BookEntry[], change: BatchChange, { now = () => new Date().toISOString(), tid = () => nextTid() }: { now?: () => string; tid?: () => string } = {}): BatchPlan {
  const writes: Write[] = []
  const undo: Write[] = []

  if (change.kind === 'status') {
    for (const e of entries) {
      const v = e.value
      if (v.status === change.status) continue
      writes.push(update(BOOK_COLLECTION, e.rkey, withStatus(v, change.status, now)))
      undo.push(update(BOOK_COLLECTION, e.rkey, v))
    }
  } else if (change.kind === 'owned') {
    for (const e of entries) {
      if ((e.value.owned === true) === change.owned) continue
      writes.push(update(BOOK_COLLECTION, e.rkey, applyPatch(e.value, { owned: change.owned ? true : null })))
      undo.push(update(BOOK_COLLECTION, e.rkey, e.value))
    }
  } else if (change.kind === 'list') {
    const { list } = change
    const added: string[] = []
    for (const e of entries) {
      const book = { hiveId: e.value.hiveId, title: e.value.title, authors: e.value.authors, identifiers: e.value.identifiers }
      if (list.items.some((item) => itemIsBook(item, book))) continue
      const rkey = tid()
      writes.push(create(LIST_ITEM, rkey, newListItem(list.uri, book, undefined, now)))
      undo.push(remove(LIST_ITEM, rkey))
      added.push(`at://${list.uri.split('/')[2]}/${LIST_ITEM}/${rkey}`)
    }
    // An ordered list names its items in order: the new ones go at the end.
    if (added.length && list.value.ordered) {
      writes.push(update(LIST, list.rkey, { ...list.value, $type: LIST, itemOrder: [...list.items.map((i) => i.uri), ...added] }))
      undo.push(update(LIST, list.rkey, list.value))
    }
    return { writes, undo, changed: added.length }
  } else {
    for (const e of entries) {
      writes.push(remove(BOOK_COLLECTION, e.rkey))
      undo.push(create(BOOK_COLLECTION, e.rkey, e.value))
    }
  }
  return { writes, undo, changed: writes.length }
}

/** "Moved 3 books to Read", for the notice after a batch. */
export function describeBatch(change: BatchChange, changed: number, statusLabel: (s: BookStatus) => string): string {
  const books = `${changed} ${changed === 1 ? 'book' : 'books'}`
  switch (change.kind) {
    case 'status':
      return `Moved ${books} to ${statusLabel(change.status)}`
    case 'owned':
      return `Marked ${books} as ${change.owned ? 'owned' : 'not owned'}`
    case 'list':
      return `Added ${books} to ${change.list.value.name}`
    case 'remove':
      return `Removed ${books} from your library`
  }
}

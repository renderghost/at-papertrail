import { BOOK_COLLECTION, type BookRecord } from '../bookhive/types'
import { isPopfeedShelf, itemIsBook, LIST, LIST_ITEM, newListItem, type BookList, type ListBook, type ListRecord } from '../lists'
import { createLimiter } from '../pool'
import { nextTid } from '../tid'
import { applyWrites, procedure, XrpcError, type SessionFetch, type Write, type WriteResult } from '../xrpc'
import type { PlanItem } from './plan'
import type { ImportSource } from './sources'

/**
 * Carries out an import plan on your PDS (#57), and undoes it.
 * - New books go in applyWrites batches with record keys made here, so every
 *   URI is known (and logged for undo) before the PDS answers.
 * - Fills to existing books are compare-and-swap puts: one changed elsewhere
 *   meanwhile is left alone, and counted.
 * - If the PDS stops accepting writes (accounts have an hourly write limit),
 *   the import stops cleanly. Running it again carries on: it only fills gaps.
 */

export type UndoLog = {
  did: string
  at: string
  source: ImportSource
  /** Records this import created: books, lists and list items. */
  created: string[]
  /** Records it changed: their value before, and the cid it left them at. */
  updated: { uri: string; cid: string; previous: Record<string, unknown> }[]
}

export type ShelfChoice = {
  name: string
  /** One of your own lists with the same name, which gets the books instead of a new list. */
  existing?: BookList
}

export type RunResult = {
  created: number
  updated: number
  stale: number
  listsCreated: number
  itemsAdded: number
  /** Why the import stopped before the end (the PDS's write limit); undefined when it finished. */
  stoppedEarly?: string
  log: UndoLog
}

export type RunProgress = { done: number; total: number }

const BATCH = 50

export function isRateLimit(err: unknown): boolean {
  return err instanceof XrpcError && (err.status === 429 || err.error === 'RateLimitExceeded')
}

const RATE_LIMITED =
  'Your PDS has paused writes for now: accounts can only write so many records an hour. Run the import again later, and it will carry on where it stopped.'

const uriFor = (did: string, collection: string, rkey: string) => `at://${did}/${collection}/${rkey}`
const rkeyOf = (uri: string) => uri.slice(uri.lastIndexOf('/') + 1)
const collectionOf = (uri: string) => uri.split('/')[3] ?? ''

/** The books each chosen shelf should hold, as list items need them. */
export function shelfBooks(plan: PlanItem[], shelf: string): ListBook[] {
  const name = shelf.toLowerCase()
  const books: ListBook[] = []
  for (const item of plan) {
    if (item.kind === 'unmatched' || !item.rows.some((r) => r.shelves.some((s) => s.toLowerCase() === name))) continue
    const value: BookRecord = item.kind === 'create' ? item.record : item.kind === 'update' ? item.next : item.entry.value
    books.push({ hiveId: value.hiveId, title: value.title, authors: value.authors, identifiers: value.identifiers })
  }
  return books
}

/** Your own list with this name (not a PopFeed shelf), to add to rather than duplicate. */
export function existingListFor(name: string, lists: BookList[]): BookList | undefined {
  const key = name.trim().toLowerCase()
  return lists.find((l) => !isPopfeedShelf(l) && l.value.name.trim().toLowerCase() === key)
}

export async function runImport(
  session: SessionFetch,
  plan: PlanItem[],
  shelves: ShelfChoice[],
  opts: { source: ImportSource; onProgress?: (p: RunProgress) => void; onLog?: (log: UndoLog) => void; now?: () => string },
): Promise<RunResult> {
  const now = opts.now ?? (() => new Date().toISOString())
  const did = session.did
  const log: UndoLog = { did, at: now(), source: opts.source, created: [], updated: [] }
  const result: RunResult = { created: 0, updated: 0, stale: 0, listsCreated: 0, itemsAdded: 0, log }
  const creates = plan.filter((p): p is PlanItem & { kind: 'create' } => p.kind === 'create')
  const updates = plan.filter((p): p is PlanItem & { kind: 'update' } => p.kind === 'update')
  const lists = shelves.map((s) => ({ shelf: s, books: shelfBooks(plan, s.name) })).filter((l) => l.books.length)
  const total = creates.length + updates.length + lists.reduce((n, l) => n + l.books.length, 0)
  let done = 0
  const tick = (n: number) => opts.onProgress?.({ done: (done += n), total })
  const remember = () => opts.onLog?.(log)

  try {
    for (let i = 0; i < creates.length; i += BATCH) {
      const batch = creates.slice(i, i + BATCH).map((c) => ({ rkey: nextTid(), value: c.record }))
      await applyWrites(
        session,
        batch.map((b): Write => ({ $type: 'com.atproto.repo.applyWrites#create', collection: BOOK_COLLECTION, rkey: b.rkey, value: b.value })),
      )
      log.created.push(...batch.map((b) => uriFor(did, BOOK_COLLECTION, b.rkey)))
      result.created += batch.length
      remember()
      tick(batch.length)
    }

    const limit = createLimiter(4)
    await Promise.all(
      updates.map((u) =>
        limit(async () => {
          if (result.stoppedEarly) return
          try {
            const res = await procedure<WriteResult>(session, 'com.atproto.repo.putRecord', {
              repo: did,
              collection: BOOK_COLLECTION,
              rkey: u.entry.rkey,
              record: u.next,
              swapRecord: u.entry.cid,
            })
            log.updated.push({ uri: u.entry.uri, cid: res.cid, previous: u.entry.value })
            result.updated++
            remember()
          } catch (err) {
            if (isRateLimit(err)) throw err
            if (err instanceof XrpcError && err.error === 'InvalidSwap') result.stale++
            else throw err
          }
          tick(1)
        }),
      ),
    )

    for (const { shelf, books } of lists) {
      const writes: Write[] = []
      let target = shelf.existing
      let listUri = target?.uri
      if (!target) {
        const rkey = nextTid()
        listUri = uriFor(did, LIST, rkey)
        const value: ListRecord = { $type: LIST, name: shelf.name.slice(0, 100), ordered: false, tags: [], createdAt: now() }
        writes.push({ $type: 'com.atproto.repo.applyWrites#create', collection: LIST, rkey, value })
      }
      const fresh = books.filter((b) => !target?.items.some((item) => itemIsBook(item, b)))
      const itemUris: string[] = []
      for (const book of fresh) {
        const rkey = nextTid()
        itemUris.push(uriFor(did, LIST_ITEM, rkey))
        writes.push({ $type: 'com.atproto.repo.applyWrites#create', collection: LIST_ITEM, rkey, value: newListItem(listUri!, book, undefined, now) })
      }
      // A ranked list gets the new books at the end of its order, in the same write.
      if (target?.value.ordered && itemUris.length) {
        writes.push({
          $type: 'com.atproto.repo.applyWrites#update',
          collection: LIST,
          rkey: target.rkey,
          value: { ...target.value, $type: LIST, itemOrder: [...target.items.map((i) => i.uri), ...itemUris] },
        })
      }
      if (writes.length) {
        const results = await applyWrites(session, writes)
        if (!target) {
          log.created.push(listUri!)
          result.listsCreated++
        } else if (target.value.ordered && itemUris.length) {
          const updated = results.at(-1) as WriteResult | undefined
          if (updated?.cid) log.updated.push({ uri: target.uri, cid: updated.cid, previous: target.value })
        }
        log.created.push(...itemUris)
        result.itemsAdded += itemUris.length
        remember()
      }
      tick(books.length)
    }
  } catch (err) {
    // Anything else is a real failure. What was written is already in the saved undo log.
    if (!isRateLimit(err)) throw err
    result.stoppedEarly = RATE_LIMITED
  }
  return result
}

export type UndoResult = { deleted: number; restored: number; skipped: number; stoppedEarly?: string }

/** Deletes what an import created and restores what it changed, unless changed again since. */
export async function undoImport(session: SessionFetch, log: UndoLog): Promise<UndoResult> {
  const out: UndoResult = { deleted: 0, restored: 0, skipped: 0 }
  // Items before their lists, and lists before books, so nothing points at a missing record for long.
  const order = [LIST_ITEM, LIST, BOOK_COLLECTION]
  const created = [...log.created].sort((a, b) => order.indexOf(collectionOf(a)) - order.indexOf(collectionOf(b)))
  try {
    for (const u of log.updated) {
      try {
        await procedure(session, 'com.atproto.repo.putRecord', {
          repo: log.did,
          collection: collectionOf(u.uri),
          rkey: rkeyOf(u.uri),
          record: u.previous,
          swapRecord: u.cid,
        })
        out.restored++
      } catch (err) {
        if (err instanceof XrpcError && err.error === 'InvalidSwap') out.skipped++
        else throw err
      }
    }
    for (let i = 0; i < created.length; i += 200) {
      const chunk = created.slice(i, i + 200)
      try {
        await applyWrites(session, chunk.map((uri): Write => ({ $type: 'com.atproto.repo.applyWrites#delete', collection: collectionOf(uri), rkey: rkeyOf(uri) })))
      } catch (err) {
        if (isRateLimit(err)) throw err
        // One already deleted by hand fails the batch; delete them one at a time instead.
        for (const uri of chunk) {
          await procedure(session, 'com.atproto.repo.deleteRecord', { repo: log.did, collection: collectionOf(uri), rkey: rkeyOf(uri) }).catch((e: unknown) => {
            if (isRateLimit(e)) throw e
          })
        }
      }
      out.deleted += chunk.length
    }
  } catch (err) {
    if (!isRateLimit(err)) throw err
    out.stoppedEarly = 'Your PDS has paused writes for now. Try undoing again later.'
  }
  return out
}

const undoKey = (did: string) => `papertrail-import-undo:${did}`

/** The last import's undo log, kept in this browser until the next import. */
export function loadUndoLog(did: string): UndoLog | null {
  try {
    const raw = localStorage.getItem(undoKey(did))
    const log = raw ? (JSON.parse(raw) as UndoLog) : null
    return log && log.did === did && Array.isArray(log.created) && Array.isArray(log.updated) ? log : null
  } catch {
    return null
  }
}

export function saveUndoLog(log: UndoLog): void {
  try {
    localStorage.setItem(undoKey(log.did), JSON.stringify(log))
  } catch {
    // Storage full or blocked: undo still works until the page is closed.
  }
}

export function clearUndoLog(did: string): void {
  try {
    localStorage.removeItem(undoKey(did))
  } catch {
    // Nothing to clear.
  }
}

import { listAllRecords, rkeyOf, type RawRecord } from '../atproto'
import { StaleRecordError } from '../errors'
import { resolvePds } from '../identity'
import { procedure, XrpcError, type SessionFetch } from '../xrpc'
import { isHiveId } from './hiveId'
import { BOOK_COLLECTION, type BookEntry, type BookRecord } from './types'

function isBookRecord(value: unknown): value is BookRecord {
  const v = value as Partial<BookRecord> | null
  return (
    !!v &&
    typeof v.title === 'string' &&
    typeof v.authors === 'string' &&
    isHiveId(v.hiveId) &&
    typeof v.createdAt === 'string'
  )
}

export function toEntries(did: string, pds: string, records: RawRecord<unknown>[]): BookEntry[] {
  return records
    .filter((r): r is RawRecord<BookRecord> => isBookRecord(r.value))
    .map((r) => ({ uri: r.uri, cid: r.cid, rkey: rkeyOf(r.uri), did, pds, value: r.value }))
}

/** Someone's whole BookHive library, read straight from their PDS. */
export async function loadLibrary(
  did: string,
  opts: { maxPages?: number; signal?: AbortSignal } = {},
): Promise<{ entries: BookEntry[]; complete: boolean }> {
  const pds = await resolvePds(did)
  const { records, complete } = await listAllRecords<unknown>(pds, did, BOOK_COLLECTION, opts)
  return { entries: toEntries(did, pds, records), complete }
}

/**
 * Field changes for a write. `null` removes the field; `undefined` (or absence)
 * leaves it alone. Fields this app doesn't model are always carried over.
 */
export type BookPatch = { [K in keyof BookRecord]?: BookRecord[K] | null }

export function applyPatch(value: BookRecord, patch: BookPatch): BookRecord {
  const next: Record<string, unknown> = { ...value, $type: BOOK_COLLECTION }
  for (const [key, v] of Object.entries(patch)) {
    if (v === null) delete next[key]
    else if (v !== undefined) next[key] = v
  }
  return next as BookRecord
}

type WriteResult = { uri: string; cid: string }

function staleOr(err: unknown): never {
  if (err instanceof XrpcError && err.error === 'InvalidSwap') throw new StaleRecordError()
  throw err
}

export async function createBook(session: SessionFetch, record: BookRecord): Promise<BookEntry> {
  const did = session.did
  const value = applyPatch(record, {})
  const res = await procedure<WriteResult>(session, 'com.atproto.repo.createRecord', {
    repo: did,
    collection: BOOK_COLLECTION,
    record: value,
  })
  return { uri: res.uri, cid: res.cid, rkey: rkeyOf(res.uri), did, pds: await resolvePds(did), value }
}

/**
 * Compare-and-swap write: the PDS refuses it if the record changed since
 * `entry.cid`, so an edit made in bookhive.buzz is never silently overwritten.
 */
export async function updateBook(session: SessionFetch, entry: BookEntry, next: BookRecord): Promise<BookEntry> {
  try {
    const res = await procedure<WriteResult>(session, 'com.atproto.repo.putRecord', {
      repo: entry.did,
      collection: BOOK_COLLECTION,
      rkey: entry.rkey,
      record: next,
      swapRecord: entry.cid,
    })
    return { ...entry, cid: res.cid, value: next }
  } catch (err) {
    return staleOr(err)
  }
}

export async function deleteBook(session: SessionFetch, entry: BookEntry): Promise<void> {
  try {
    await procedure(session, 'com.atproto.repo.deleteRecord', {
      repo: entry.did,
      collection: BOOK_COLLECTION,
      rkey: entry.rkey,
      swapRecord: entry.cid,
    })
  } catch (err) {
    staleOr(err)
  }
}

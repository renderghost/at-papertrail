import { HttpError } from '../atproto'
import { cleanIsbn, isbn13To10 } from '../isbn'
import type { BookProgress, CatalogBook, PreviousRead } from './types'

/**
 * BookHive's own XRPC API, through Papertrail's same-origin relay
 * (`api/bookhive/[method].ts`): bookhive.buzz sends no CORS headers. Each call
 * is public and anonymous; anything that fails here has a slower fallback
 * (catalogue records on @bookhive.buzz's PDS, Open Library, Google Books).
 */

/** A `buzz.bookhive.hiveBook`: the catalogue entry as BookHive's API returns it. */
export type HiveBook = CatalogBook

export type HiveReview = {
  did: string
  handle: string
  review: string
  stars?: number
  createdAt: string
  uri?: string
  cid?: string
}

export type HiveComment = {
  did: string
  handle: string
  comment: string
  createdAt: string
  uri?: string
  parent?: { uri: string; cid: string }
  book?: { uri: string; cid: string }
}

export type HiveActivity = {
  type: 'review' | 'rated' | 'started' | 'finished' | string
  createdAt: string
  hiveId: string
  title: string
  userDid: string
  userHandle: string
}

export type HiveBookDetail = {
  book: HiveBook
  reviews: HiveReview[]
  comments: HiveComment[]
  activity?: HiveActivity[]
  /** The viewer's own copy; never present here, because calls are anonymous. */
  status?: string
  stars?: number
  bookProgress?: BookProgress
  previousReads?: PreviousRead[]
}

type Params = Record<string, string | number | undefined>

async function call<T>(method: string, params: Params, signal?: AbortSignal): Promise<T> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') query.set(key, String(value))
  const url = `${import.meta.env.BASE_URL}api/bookhive/${method}${query.size ? `?${query}` : ''}`
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } })
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string }
  if (!res.ok) throw new HttpError(res.status, body.error, body.message ?? `BookHive ${method} failed (${res.status})`)
  return body
}

/** BookHive's catalogue search (title, author or ISBN). */
export async function searchHive(q: string, { limit = 10, signal }: { limit?: number; signal?: AbortSignal } = {}) {
  const res = await call<{ books?: HiveBook[] }>('searchBooks', { q, limit }, signal)
  return (res.books ?? []).filter((b) => typeof b?.id === 'string' && typeof b.title === 'string')
}

/** A book with everyone's BookHive reviews, comments and recent activity; null if BookHive doesn't know it. */
export async function getHiveBook(id: string, signal?: AbortSignal): Promise<HiveBookDetail | null> {
  try {
    const res = await call<HiveBookDetail>('getBook', { id }, signal)
    return {
      ...res,
      reviews: Array.isArray(res.reviews) ? res.reviews : [],
      comments: Array.isArray(res.comments) ? res.comments : [],
      activity: Array.isArray(res.activity) ? res.activity : [],
    }
  } catch (err) {
    if (err instanceof HttpError && (err.status === 404 || err.status === 400)) return null
    throw err
  }
}

async function identifiersFor(params: Params, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await call<{ bookIdentifiers?: { hiveId?: string } }>('getBookIdentifiers', params, signal)
    return res.bookIdentifiers?.hiveId ?? null
  } catch (err) {
    if (err instanceof HttpError && (err.status === 404 || err.status === 400)) return null
    throw err
  }
}

/**
 * The hiveId BookHive uses for an ISBN, if it has the book. BookHive's
 * ISBN-13 lookup misses books its ISBN-10 lookup finds (seen 29 Oct 2026), so
 * a 978 ISBN-13 is retried as its ISBN-10.
 */
export async function hiveIdForIsbn(isbn: string, signal?: AbortSignal): Promise<string | null> {
  const clean = cleanIsbn(isbn)
  if (clean.length === 10) return identifiersFor({ isbn10: clean }, signal)
  if (clean.length !== 13) return null
  const found = await identifiersFor({ isbn13: clean }, signal)
  if (found) return found
  const isbn10 = isbn13To10(clean)
  return isbn10 ? identifiersFor({ isbn10 }, signal) : null
}

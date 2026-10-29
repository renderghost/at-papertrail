import { getRecord } from './atproto'
import type { BookIdentifiers } from './bookhive/types'
import { StaleRecordError } from './errors'
import { resolvePds } from './identity'
import { procedure, XrpcError, type SessionFetch } from './xrpc'

/**
 * Favourite books, in the reader's PopFeed profile record
 * (`social.popfeed.actor.profile`, key "self"), so they show on PopFeed too.
 * The record holds much more (name, bio, links, other media's favourites):
 * Papertrail only ever changes `favorites.books` and keeps everything else.
 */

export const POPFEED_PROFILE = 'social.popfeed.actor.profile'
export const MAX_FAVOURITES = 10

export type FavouriteBook = {
  title: string
  identifiers: BookIdentifiers & { [key: string]: unknown }
  creativeWorkType: 'book'
  posterUrl?: string
  [key: string]: unknown
}

export type PopfeedProfile = {
  $type?: typeof POPFEED_PROFILE
  displayName?: string
  description?: string
  externalLinks?: unknown[]
  favorites?: { books?: FavouriteBook[]; [key: string]: unknown }
  createdAt?: string
  [key: string]: unknown
}

export type ProfileRecord = { cid: string; value: PopfeedProfile } | null

export async function loadPopfeedProfile(did: string, signal?: AbortSignal): Promise<ProfileRecord> {
  const pds = await resolvePds(did)
  const record = await getRecord<PopfeedProfile>(pds, did, POPFEED_PROFILE, 'self', signal)
  return record ? { cid: record.cid, value: record.value } : null
}

export function favouriteBooks(profile: ProfileRecord): FavouriteBook[] {
  const books = profile?.value.favorites?.books
  return Array.isArray(books) ? books.filter((b) => b && typeof b.title === 'string' && b.identifiers) : []
}

export function toFavourite(book: { hiveId: string; title: string; identifiers?: BookIdentifiers; coverUrl?: string }): FavouriteBook {
  const identifiers: FavouriteBook['identifiers'] = { hiveId: book.hiveId }
  if (book.identifiers?.isbn10) identifiers.isbn10 = book.identifiers.isbn10
  if (book.identifiers?.isbn13) identifiers.isbn13 = book.identifiers.isbn13
  return {
    title: book.title,
    identifiers,
    creativeWorkType: 'book',
    ...(book.coverUrl?.startsWith('https://') ? { posterUrl: book.coverUrl } : {}),
  }
}

/** The profile record with new favourite books and everything else unchanged. */
export function withFavourites(profile: ProfileRecord, books: FavouriteBook[], now = () => new Date().toISOString()): PopfeedProfile {
  const current = profile?.value ?? { createdAt: now() }
  return {
    ...current,
    $type: POPFEED_PROFILE,
    favorites: { ...current.favorites, books: books.slice(0, MAX_FAVOURITES) },
  }
}

/** Saves favourite books with a compare-and-swap write (creating the record if there's none). */
export async function saveFavourites(session: SessionFetch, profile: ProfileRecord, books: FavouriteBook[]): Promise<ProfileRecord> {
  const value = withFavourites(profile, books)
  try {
    const res = await procedure<{ cid: string }>(session, 'com.atproto.repo.putRecord', {
      repo: session.did,
      collection: POPFEED_PROFILE,
      rkey: 'self',
      record: value,
      // null asserts the record doesn't exist yet, so a profile created meanwhile isn't clobbered.
      swapRecord: profile?.cid ?? null,
    })
    return { cid: res.cid, value }
  } catch (err) {
    if (err instanceof XrpcError && err.error === 'InvalidSwap') throw new StaleRecordError()
    throw err
  }
}

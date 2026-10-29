import { listAllRecords, rkeyOf, type RawRecord } from './atproto'
import { resolvePds } from './identity'
import { isbnKeys } from './isbn'

/**
 * PopFeed's records, read-only. PopFeed doesn't publish its lexicons; these
 * shapes come from live records (October 2026). Papertrail reads PopFeed
 * reviews but writes reviews only to `buzz.bookhive.book`.
 */

export const POPFEED_REVIEW = 'social.popfeed.feed.review'

export type PopfeedReview = {
  creativeWorkType?: string
  /** 0–10, like BookHive's stars (but 0 is allowed). */
  rating?: number
  text?: string
  containsSpoilers?: boolean
  isRevisit?: boolean
  tags?: string[]
  identifiers?: { isbn10?: string; isbn13?: string; hiveId?: string }
  title?: string
  mainCredit?: string
  createdAt: string
}

export type ReviewEntry = { uri: string; cid: string; rkey: string; did: string; value: PopfeedReview }

function isBookReview(value: unknown): value is PopfeedReview {
  const v = value as PopfeedReview | null
  return !!v && v.creativeWorkType === 'book' && typeof v.createdAt === 'string'
}

export function toReviewEntries(did: string, records: RawRecord<unknown>[]): ReviewEntry[] {
  return records
    .filter((r): r is RawRecord<PopfeedReview> => isBookReview(r.value))
    .map((r) => ({ uri: r.uri, cid: r.cid, rkey: rkeyOf(r.uri), did, value: r.value }))
}

/** Someone's PopFeed book reviews, newest first. */
export async function loadBookReviews(
  did: string,
  opts: { maxPages?: number; signal?: AbortSignal } = {},
): Promise<ReviewEntry[]> {
  const pds = await resolvePds(did)
  const { records } = await listAllRecords<unknown>(pds, did, POPFEED_REVIEW, opts)
  return toReviewEntries(did, records)
}

/** Whether a PopFeed review is about this book: by hiveId, or by any spelling of its ISBNs. */
export function reviewMatches(
  review: PopfeedReview,
  book: { hiveId: string; identifiers?: { isbn10?: string; isbn13?: string } },
): boolean {
  if (review.identifiers?.hiveId && review.identifiers.hiveId === book.hiveId) return true
  const theirs = isbnKeys(review.identifiers)
  if (theirs.length === 0) return false
  const ours = new Set(isbnKeys(book.identifiers))
  return theirs.some((k) => ours.has(k))
}

import type { Profile } from './atproto'
import { STATUS, type BookEntry } from './bookhive/types'

/**
 * Discovery feed events, derived from the current state of each book record.
 *
 * `buzz.bookhive.book` stores state, not history: started and finished have
 * their own dates, but a review or rating does not. Those are shown with the
 * finish date when there is one, otherwise the last progress update or the
 * date the book was added. Abandoned books are left out of the feed.
 */

export type FeedEventKind = 'started' | 'finished' | 'reviewed' | 'rated' | 'wantToRead'

export type FeedEvent = {
  id: string
  kind: FeedEventKind
  date: string
  profile: Profile
  entry: BookEntry
  stars?: number
  review?: string
  /** A finish from the book's read history, i.e. an earlier read. */
  earlierRead?: boolean
}

export const FEED_FILTERS: { kind: FeedEventKind | 'all'; label: string }[] = [
  { kind: 'all', label: 'Everything' },
  { kind: 'started', label: 'Started' },
  { kind: 'finished', label: 'Finished' },
  { kind: 'reviewed', label: 'Reviewed & rated' },
  { kind: 'wantToRead', label: 'Want to read' },
]

const DAY = 86_400_000

function valid(date: string | undefined, now: number): date is string {
  if (!date) return false
  const t = Date.parse(date)
  return Number.isFinite(t) && t <= now + DAY
}

export function eventsForEntry(profile: Profile, entry: BookEntry, now = Date.now()): FeedEvent[] {
  const v = entry.value
  const events: FeedEvent[] = []
  const base = { profile, entry }
  const finishedNow = v.status === STATUS.finished && valid(v.finishedAt, now)

  if (v.status !== STATUS.wantToRead && valid(v.startedAt, now)) {
    events.push({ ...base, id: `${entry.uri}#started`, kind: 'started', date: v.startedAt })
  }
  if (finishedNow) {
    events.push({
      ...base,
      id: `${entry.uri}#finished`,
      kind: 'finished',
      date: v.finishedAt!,
      stars: v.stars,
      review: v.review,
    })
  }
  for (const [i, read] of (v.previousReads ?? []).entries()) {
    if (valid(read.finishedAt, now)) {
      events.push({ ...base, id: `${entry.uri}#read-${i}`, kind: 'finished', date: read.finishedAt, earlierRead: true })
    }
  }
  if ((v.review || v.stars) && !finishedNow) {
    const date = v.bookProgress?.updatedAt ?? v.createdAt
    if (valid(date, now)) {
      events.push({
        ...base,
        id: `${entry.uri}#review`,
        kind: v.review ? 'reviewed' : 'rated',
        date,
        stars: v.stars,
        review: v.review,
      })
    }
  }
  if (v.status === STATUS.wantToRead && valid(v.createdAt, now)) {
    events.push({ ...base, id: `${entry.uri}#want`, kind: 'wantToRead', date: v.createdAt })
  }
  return events
}

export function buildFeed(readers: { profile: Profile; books: BookEntry[] }[], now = Date.now()): FeedEvent[] {
  const events = readers.flatMap((r) => r.books.flatMap((b) => eventsForEntry(r.profile, b, now)))
  return events.sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || a.id.localeCompare(b.id))
}

export function matchesFilter(event: FeedEvent, filter: FeedEventKind | 'all'): boolean {
  if (filter === 'all') return true
  if (filter === 'reviewed') return event.kind === 'reviewed' || event.kind === 'rated' || !!event.review
  return event.kind === filter
}

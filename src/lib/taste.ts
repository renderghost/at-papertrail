import type { Profile } from './atproto'
import { sameBookKeys } from './bookclub'
import { progressPercent } from './bookhive/lifecycle'
import { STATUS, type BookEntry } from './bookhive/types'
import { reviewMatches, type ReviewEntry } from './popfeed'

/**
 * Taste twins (#63) and your network's take on a book (#64): how alike your
 * reading is to someone else's, from your public BookHive libraries plus
 * their PopFeed ratings. Computed in the browser; nothing is stored.
 */

/** Four stars and up (stars are 1–10). */
export const LOVED = 8

export type Shared = {
  mine: BookEntry
  theirs: BookEntry
  /** Ratings on BookHive's 1–10 scale; theirs falls back to a PopFeed review of the same book. */
  myStars?: number
  theirStars?: number
}

export type Confidence = 'none' | 'low' | 'medium' | 'high'

export type TasteMatch = {
  /** 0–100, or null with too little in common to say. */
  score: number | null
  confidence: Confidence
  shared: Shared[]
  /** Shared books you both rated, and how far apart your ratings are on average, in stars (0–4.5). */
  rated: number
  averageGap: number | null
  bothLoved: Shared[]
  /** Two stars or more apart, the widest first. */
  disagreements: Shared[]
  /** Books they loved that you haven't read (some may be on your want-to-read list). */
  theirPicks: BookEntry[]
}

export type ReaderLike = { books: BookEntry[]; reviews?: ReviewEntry[] }

/** Their rating of a book: on their BookHive copy, else from a PopFeed review of it. */
export function theirRating(entry: BookEntry, reviews: ReviewEntry[]): number | undefined {
  if (entry.value.stars) return entry.value.stars
  const review = reviews.find((r) => reviewMatches(r.value, { hiveId: entry.value.hiveId, identifiers: entry.value.identifiers }))
  return review?.value.rating || undefined
}

type Outcome = 'loved' | 'finished' | 'abandoned' | 'other'

function outcome(entry: BookEntry, stars: number | undefined): Outcome {
  if (entry.value.status === STATUS.abandoned) return 'abandoned'
  if (stars !== undefined && stars >= LOVED) return 'loved'
  return entry.value.status === STATUS.finished || entry.value.previousReads?.length ? 'finished' : 'other'
}

function confidenceFor(shared: number, rated: number): Confidence {
  if (shared < 3) return 'none'
  if (shared < 8 || rated < 3) return 'low'
  return shared < 20 ? 'medium' : 'high'
}

/** How alike two libraries are, and the books that show it. */
export function tasteMatch(mine: BookEntry[], them: ReaderLike): TasteMatch {
  const reviews = them.reviews ?? []
  const index = new Map<string, BookEntry>()
  for (const entry of them.books) for (const key of sameBookKeys(entry)) if (!index.has(key)) index.set(key, entry)

  const shared: Shared[] = []
  const matched = new Set<BookEntry>()
  for (const entry of mine) {
    const theirs = sameBookKeys(entry)
      .map((k) => index.get(k))
      .find(Boolean)
    if (!theirs || matched.has(theirs)) continue
    matched.add(theirs)
    const theirStars = theirRating(theirs, reviews)
    shared.push({ mine: entry, theirs, ...(entry.value.stars ? { myStars: entry.value.stars } : {}), ...(theirStars ? { theirStars } : {}) })
  }

  const rated = shared.filter((s) => s.myStars && s.theirStars)
  const averageGap = rated.length ? rated.reduce((sum, s) => sum + Math.abs(s.myStars! - s.theirStars!), 0) / rated.length / 2 : null
  const confidence = confidenceFor(shared.length, rated.length)

  let score: number | null = null
  if (confidence !== 'none') {
    // Agreeing on ratings counts most, then on what was worth finishing (both loved it, both gave up).
    let agree = 0
    let clash = 0
    for (const s of shared) {
      const a = outcome(s.mine, s.myStars)
      const b = outcome(s.theirs, s.theirStars)
      if (a === b && (a === 'loved' || a === 'abandoned')) agree++
      else if ((a === 'loved' && b === 'abandoned') || (a === 'abandoned' && b === 'loved')) clash++
    }
    const outcomes = 0.5 + (agree - clash) / (2 * shared.length)
    // Three stars apart on average is no agreement at all.
    const agreement = averageGap === null ? null : Math.max(0, 1 - averageGap / 3)
    const base = agreement === null ? outcomes : 0.8 * agreement + 0.2 * outcomes
    // Reading much the same books nudges it up; it never makes up for disagreeing.
    const overlap = Math.min(1, (2 * shared.length) / Math.sqrt(Math.max(1, mine.length) * Math.max(1, them.books.length)))
    score = Math.round(100 * base * (0.85 + 0.15 * overlap))
  }

  // Still unread if it's only on your want-to-read list, so a pick you just added stays put, showing your status.
  const triedKeys = new Set(mine.filter((e) => e.value.status !== STATUS.wantToRead).flatMap(sameBookKeys))
  const theirPicks = them.books
    .filter((b) => !sameBookKeys(b).some((k) => triedKeys.has(k)))
    .filter((b) => (theirRating(b, reviews) ?? 0) >= LOVED)
    .sort((a, b) => (theirRating(b, reviews) ?? 0) - (theirRating(a, reviews) ?? 0))

  return {
    score,
    confidence,
    shared,
    rated: rated.length,
    averageGap,
    bothLoved: shared.filter((s) => (s.myStars ?? 0) >= LOVED && (s.theirStars ?? 0) >= LOVED),
    disagreements: rated.filter((s) => Math.abs(s.myStars! - s.theirStars!) >= 4).sort((a, b) => Math.abs(b.myStars! - b.theirStars!) - Math.abs(a.myStars! - a.theirStars!)),
    theirPicks,
  }
}

export type Twin<R extends ReaderLike & { profile: Profile }> = { reader: R; match: TasteMatch }

/** Everyone you follow, most like you first; those with too little in common last, by books shared. */
export function tasteTwins<R extends ReaderLike & { profile: Profile }>(mine: BookEntry[], readers: R[], myDid?: string): Twin<R>[] {
  return readers
    .filter((r) => r.profile.did !== myDid)
    .map((reader) => ({ reader, match: tasteMatch(mine, reader) }))
    .filter((t) => t.match.shared.length > 0)
    .sort((a, b) => (b.match.score ?? -1) - (a.match.score ?? -1) || b.match.shared.length - a.match.shared.length)
}

/** "84% match" or "Not enough in common yet", with how sure we are. */
export function describeMatch(match: TasteMatch): { headline: string; detail: string } {
  const books = `${match.shared.length} ${match.shared.length === 1 ? 'book' : 'books'} in common`
  if (match.score === null) return { headline: 'Not enough in common yet', detail: books }
  const gap =
    match.averageGap === null
      ? 'no ratings to compare yet'
      : match.averageGap < 0.25
        ? 'you rate them almost the same'
        : `your ratings are ${match.averageGap.toFixed(1)} stars apart on average`
  const sure = match.confidence === 'low' ? ' (early days)' : ''
  return { headline: `${match.score}% match${sure}`, detail: `${books}; ${gap}` }
}

export type NetworkTake = {
  readers: number
  /** Their ratings' average in stars (0.5–5), if any rated it. */
  average: number | null
  loved: number
  finished: number
  reading: number
  abandoned: number
}

/** What a set of readers did with one book: a want-to-read verdict at a glance. */
export function networkTake(entries: BookEntry[], ratings: (number | undefined)[] = entries.map((e) => e.value.stars)): NetworkTake {
  const stars = ratings.filter((s): s is number => !!s)
  return {
    readers: entries.length,
    average: stars.length ? stars.reduce((a, b) => a + b, 0) / stars.length / 2 : null,
    loved: ratings.filter((s) => (s ?? 0) >= LOVED).length,
    finished: entries.filter((e) => e.value.status === STATUS.finished || e.value.previousReads?.length).length,
    reading: entries.filter((e) => e.value.status === STATUS.reading).length,
    abandoned: entries.filter((e) => e.value.status === STATUS.abandoned).length,
  }
}

/** Where someone gave up on a book: "at 34%" or "on page 120 of 350", if they said. */
export function stoppedAt(entry: BookEntry): string | null {
  if (entry.value.status !== STATUS.abandoned) return null
  const p = entry.value.bookProgress
  if (p?.currentPage && p.totalPages) return `on page ${p.currentPage} of ${p.totalPages}`
  const percent = progressPercent(p)
  return percent !== null ? `at ${percent}%` : null
}

/** A Bluesky compose link asking the people who've read a book whether it's worth it. Opens Bluesky's composer to edit first. */
export function askUrl(title: string, handles: string[], link: string): string {
  const people = handles.slice(0, 6).map((h) => `@${h}`)
  const text = `${people.length ? `${people.join(' ')} ` : ''}is ${title} worth it? 📚 ${link}`
  return `https://bsky.app/intent/compose?text=${encodeURIComponent(text)}`
}

export type NetworkCopy<R> = { reader: R; entry: BookEntry }

/** Every follow's copy of every book, by the keys that find "the same book" across catalogue records. */
export function networkIndex<R extends { profile: Profile; books: BookEntry[] }>(readers: R[], myDid?: string): Map<string, NetworkCopy<R>[]> {
  const index = new Map<string, NetworkCopy<R>[]>()
  for (const reader of readers) {
    if (reader.profile.did === myDid) continue
    for (const entry of reader.books) for (const key of sameBookKeys(entry)) index.set(key, [...(index.get(key) ?? []), { reader, entry }])
  }
  return index
}

/** The people you follow who have a book, once each, most like you first. */
export function copiesOf<R extends { profile: Profile }>(entry: BookEntry, index: Map<string, NetworkCopy<R>[]>, trust: Map<string, number> = new Map()): NetworkCopy<R>[] {
  const seen = new Map<string, NetworkCopy<R>>()
  for (const key of sameBookKeys(entry)) for (const copy of index.get(key) ?? []) if (!seen.has(copy.reader.profile.did)) seen.set(copy.reader.profile.did, copy)
  return [...seen.values()].sort((a, b) => (trust.get(b.reader.profile.did) ?? -1) - (trust.get(a.reader.profile.did) ?? -1))
}

/** Each follow's match score, for ranking their opinions ("ranked by trust"). */
export function trustScores<R extends ReaderLike & { profile: Profile }>(mine: BookEntry[], readers: R[], myDid?: string): Map<string, number> {
  return new Map(tasteTwins(mine, readers, myDid).map((t) => [t.reader.profile.did, t.match.score ?? -1]))
}

/** "3 have read it · 4.3 stars on average · 1 gave up", or that nobody has. */
export function describeTake(take: NetworkTake): string {
  if (!take.readers) return 'Nobody you follow has read it yet'
  const parts = [`${take.finished} ${take.finished === 1 ? 'has' : 'have'} read it`]
  if (take.average !== null) parts.push(`${take.average.toFixed(1)} stars on average`)
  if (take.loved) parts.push(`${take.loved} loved it`)
  if (take.reading) parts.push(`${take.reading} reading now`)
  if (take.abandoned) parts.push(`${take.abandoned} gave up`)
  return parts.join(' · ')
}

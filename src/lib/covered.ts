import { firstAuthor } from './bookhive/authors'
import { STATUS, type BookEntry } from './bookhive/types'

/**
 * Covered: a look back at a year or a month of reading. Periods use UTC
 * boundaries because BookHive stores reading dates as UTC midnights.
 */

export type Period = { kind: 'year'; year: number } | { kind: 'month'; year: number; month: number }

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

export function periodRange(p: Period): [start: number, end: number] {
  if (p.kind === 'year') return [Date.UTC(p.year, 0, 1), Date.UTC(p.year + 1, 0, 1)]
  return [Date.UTC(p.year, p.month, 1), Date.UTC(p.year, p.month + 1, 1)]
}

export function periodLabel(p: Period): string {
  return p.kind === 'year' ? String(p.year) : `${MONTHS[p.month]} ${p.year}`
}

export function periodSlug(p: Period): string {
  return p.kind === 'year' ? String(p.year) : `${p.year}-${String(p.month + 1).padStart(2, '0')}`
}

export function parsePeriodSlug(slug: string | undefined): Period | null {
  const m = slug?.match(/^(\d{4})(?:-(\d{2}))?$/)
  if (!m) return null
  const year = Number(m[1])
  if (!m[2]) return { kind: 'year', year }
  const month = Number(m[2]) - 1
  return month >= 0 && month < 12 ? { kind: 'month', year, month } : null
}

function inRange(iso: string | undefined, [start, end]: [number, number]): boolean {
  if (!iso) return false
  const t = Date.parse(iso)
  return t >= start && t < end
}

/** One completed read of a book; a re-read book can have several. */
export type Read = {
  entry: BookEntry
  startedAt?: string
  finishedAt: string
  /** True for reads from `previousReads`, and the current read of a re-read book. */
  reread: boolean
}

export function allReads(books: BookEntry[]): Read[] {
  const reads: Read[] = []
  for (const entry of books) {
    const v = entry.value
    const earlier = v.previousReads ?? []
    if (v.status === STATUS.finished && v.finishedAt) {
      reads.push({ entry, startedAt: v.startedAt, finishedAt: v.finishedAt, reread: earlier.length > 0 })
    }
    earlier.forEach((r, i) => {
      // The oldest read was the first; later ones are re-reads.
      reads.push({ entry, startedAt: r.startedAt, finishedAt: r.finishedAt, reread: i < earlier.length - 1 })
    })
  }
  return reads.sort((a, b) => Date.parse(a.finishedAt) - Date.parse(b.finishedAt))
}

export function readsIn(books: BookEntry[], period: Period): Read[] {
  const range = periodRange(period)
  return allReads(books).filter((r) => inRange(r.finishedAt, range))
}

/** Years (newest first) and, per year, months that have at least one finished read. */
export function availablePeriods(books: BookEntry[]): { year: number; months: number[] }[] {
  const byYear = new Map<number, Set<number>>()
  for (const read of allReads(books)) {
    const d = new Date(read.finishedAt)
    if (Number.isNaN(d.getTime())) continue
    const months = byYear.get(d.getUTCFullYear()) ?? new Set<number>()
    months.add(d.getUTCMonth())
    byYear.set(d.getUTCFullYear(), months)
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => b - a)
    .map(([year, months]) => ({ year, months: [...months].sort((a, b) => a - b) }))
}

/** Page counts and genres, usually from BookHive's catalogue. */
export type BookFacts = { pages?: number; genres?: string[] }

export type CoveredStats = {
  period: Period
  reads: Read[]
  booksFinished: number
  pagesRead: number
  /** How many reads had a known page count. */
  pagesKnown: number
  averageDays: number | null
  fastest: { read: Read; days: number } | null
  slowest: { read: Read; days: number } | null
  longest: { read: Read; pages: number } | null
  shortest: { read: Read; pages: number } | null
  topRated: Read[]
  /** Average of ratings given, on the 0–5 display scale. */
  averageRating: number | null
  topGenres: { genre: string; count: number }[]
  topAuthor: { name: string; count: number } | null
  /** Finishes per month (year periods only). */
  byMonth: number[] | null
  busiestMonth: { month: number; count: number } | null
  /** Longest run of consecutive months with a finish (year periods only). */
  monthStreak: number
  started: number
  abandoned: number
  reviewed: number
  rereads: number
  first: Read | null
  last: Read | null
}

const DAY = 86_400_000

/** Calendar days spent on a read, counting both ends: same-day reads take one day. */
export function daysToRead(read: Read): number | null {
  if (!read.startedAt) return null
  const start = Date.parse(read.startedAt.slice(0, 10))
  const end = Date.parse(read.finishedAt.slice(0, 10))
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return Math.round((end - start) / DAY) + 1
}

/** Genres too broad to say anything about a reader. */
const BROAD_GENRES = new Set(['fiction', 'nonfiction', 'non-fiction', 'books', 'novels', 'audiobook'])

export function computeCovered(
  books: BookEntry[],
  period: Period,
  facts: (entry: BookEntry) => BookFacts | undefined,
): CoveredStats {
  const range = periodRange(period)
  const reads = readsIn(books, period)

  let pagesRead = 0
  let pagesKnown = 0
  let longest: CoveredStats['longest'] = null
  let shortest: CoveredStats['shortest'] = null
  const genreCounts = new Map<string, number>()
  const authorCounts = new Map<string, number>()
  const durations: { read: Read; days: number }[] = []

  for (const read of reads) {
    const f = facts(read.entry)
    const pages = f?.pages ?? read.entry.value.bookProgress?.totalPages
    if (pages && pages > 0) {
      pagesRead += pages
      pagesKnown++
      if (!longest || pages > longest.pages) longest = { read, pages }
      if (!shortest || pages < shortest.pages) shortest = { read, pages }
    }
    for (const genre of new Set(f?.genres ?? [])) {
      if (BROAD_GENRES.has(genre.toLowerCase())) continue
      genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1)
    }
    const author = firstAuthor(read.entry.value.authors)
    if (author) authorCounts.set(author, (authorCounts.get(author) ?? 0) + 1)
    const days = daysToRead(read)
    if (days !== null) durations.push({ read, days })
  }

  // Ratings and reviews belong to the record, not a read: count each book once.
  const latestReadPerBook = [...new Map(reads.map((r) => [r.entry.uri, r])).values()]
  const rated = latestReadPerBook.filter((r) => r.entry.value.stars)
  const topRated = [...rated]
    .sort((a, b) => (b.entry.value.stars ?? 0) - (a.entry.value.stars ?? 0) || Date.parse(b.finishedAt) - Date.parse(a.finishedAt))
    .slice(0, 3)
  const averageRating = rated.length
    ? rated.reduce((sum, r) => sum + (r.entry.value.stars ?? 0), 0) / rated.length / 2
    : null

  const sortedDurations = [...durations].sort((a, b) => a.days - b.days)
  const topAuthorEntry = [...authorCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]

  let byMonth: number[] | null = null
  let busiestMonth: CoveredStats['busiestMonth'] = null
  let monthStreak = 0
  if (period.kind === 'year') {
    byMonth = Array.from({ length: 12 }, () => 0)
    for (const read of reads) byMonth[new Date(read.finishedAt).getUTCMonth()]!++
    byMonth.forEach((count, month) => {
      if (count > 0 && (!busiestMonth || count > busiestMonth.count)) busiestMonth = { month, count }
    })
    let run = 0
    for (const count of byMonth) {
      run = count > 0 ? run + 1 : 0
      monthStreak = Math.max(monthStreak, run)
    }
  }

  let started = 0
  let abandoned = 0
  for (const entry of books) {
    const v = entry.value
    if (inRange(v.startedAt, range)) started++
    for (const r of v.previousReads ?? []) if (inRange(r.startedAt, range)) started++
    if (v.status === STATUS.abandoned && inRange(v.bookProgress?.updatedAt ?? v.startedAt ?? v.createdAt, range)) {
      abandoned++
    }
  }

  return {
    period,
    reads,
    booksFinished: reads.length,
    pagesRead,
    pagesKnown,
    averageDays: durations.length ? durations.reduce((s, d) => s + d.days, 0) / durations.length : null,
    fastest: sortedDurations[0] ?? null,
    slowest: sortedDurations.length > 1 ? sortedDurations[sortedDurations.length - 1]! : null,
    longest,
    shortest: shortest && longest && shortest.read !== longest.read ? shortest : null,
    topRated,
    averageRating,
    topGenres: [...genreCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([genre, count]) => ({ genre, count })),
    topAuthor: topAuthorEntry && topAuthorEntry[1] >= 2 ? { name: topAuthorEntry[0], count: topAuthorEntry[1] } : null,
    byMonth,
    busiestMonth,
    monthStreak,
    started,
    abandoned,
    reviewed: latestReadPerBook.filter((r) => r.entry.value.review).length,
    rereads: reads.filter((r) => r.reread).length,
    first: reads[0] ?? null,
    last: reads.length > 1 ? reads[reads.length - 1]! : null,
  }
}

import { STATUS, type BookStatus, type PreviousRead } from '../bookhive/types'
import { csvRecords } from '../csv'
import { cleanIsbn } from '../isbn'

/**
 * Goodreads, StoryGraph and Hardcover library exports (#57), read into one
 * shape. The mapping follows bookhive.buzz's own importer
 * (`src/core/importBook.ts` upstream) so the records come out the same, and
 * goes further where the files allow: did-not-finish becomes abandoned, start
 * dates are kept, and StoryGraph's re-reads become `previousReads`.
 */

export type ImportSource = 'goodreads' | 'storygraph' | 'hardcover'

export const SOURCE_NAME: Record<ImportSource, string> = {
  goodreads: 'Goodreads',
  storygraph: 'StoryGraph',
  hardcover: 'Hardcover',
}

export type ImportRow = {
  /** Line in the file, counting the header as 1. */
  line: number
  title: string
  /** The title without a Goodreads-style "(Series, #3)" suffix: what BookHive's hiveId is made from. */
  bareTitle: string
  /** Primary author first; narrators, translators and illustrators are dropped. */
  authors: string[]
  isbn10?: string
  isbn13?: string
  goodreadsId?: string
  status: BookStatus
  createdAt?: string
  startedAt?: string
  finishedAt?: string
  /** Earlier reads, most recent first. */
  previousReads: PreviousRead[]
  /** 1–10 (half stars). */
  stars?: number
  /** A quarter-star rating was rounded to the nearest half. */
  ratingRounded: boolean
  review?: string
  owned: boolean
  /** Custom shelves, tags or lists, which can become PopFeed lists. */
  shelves: string[]
  /** What the file holds that Papertrail can't store yet (#17, #56). */
  extras: { moods: boolean; pace: boolean; contentWarnings: boolean; spoiler: boolean; undatedRereads: number }
}

export type ParsedExport = { source: ImportSource; rows: ImportRow[]; skipped: number }

export class ImportFileError extends Error {}

const REQUIRED: Record<ImportSource, string[]> = {
  goodreads: ['Book Id', 'Title', 'Author', 'Exclusive Shelf'],
  storygraph: ['Title', 'Authors', 'Read Status', 'ISBN/UID'],
  hardcover: ['Title', 'Author', 'Status', 'Hardcover Book ID'],
}

export function detectSource(headers: string[]): ImportSource | null {
  const has = new Set(headers)
  return (Object.keys(REQUIRED) as ImportSource[]).find((s) => REQUIRED[s].every((h) => has.has(h))) ?? null
}

/** Shelf names that mean "did not finish" on Goodreads, where it's a custom shelf. */
const DNF_SHELVES = new Set(['did-not-finish', 'dnf', 'abandoned', 'gave-up', 'didnt-finish', 'did-not-finish-dnf', 'not-finished'])
const GOODREADS_EXCLUSIVE = new Set(['read', 'currently-reading', 'to-read'])

/** "2024/12/15", "2024-12-15" or an ISO datetime → the midnight-UTC ISO BookHive stores. */
export function parseExportDate(value: string | undefined): string | undefined {
  const v = value?.trim()
  if (!v) return undefined
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:$|[T ])/.exec(v)
  if (!m) return undefined
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return undefined
  return date.toISOString()
}

/** 0–5 stars (quarters allowed) → BookHive's 1–10, rounded to the nearest half star. */
export function toStars(rating: string | undefined): { stars?: number; rounded: boolean } {
  const r = Number.parseFloat(rating ?? '')
  if (!Number.isFinite(r) || r <= 0) return { rounded: false }
  const doubled = r * 2
  const stars = Math.min(10, Math.max(1, Math.round(doubled)))
  return { stars, rounded: Math.abs(doubled - Math.round(doubled)) > 1e-9 }
}

/** Goodreads wraps ISBNs as ="…" so spreadsheets keep them intact; StoryGraph may hold a non-ISBN id. */
export function isbnsFrom(...values: (string | undefined)[]): { isbn10?: string; isbn13?: string } {
  const out: { isbn10?: string; isbn13?: string } = {}
  for (const raw of values) {
    const v = cleanIsbn((raw ?? '').replace(/^="?|"$/g, ''))
    if (/^97[89]\d{10}$/.test(v)) out.isbn13 ??= v
    else if (/^\d{9}[\dX]$/.test(v)) out.isbn10 ??= v
  }
  return out
}

/** "Onyx Storm (The Empyrean, #3)" → "Onyx Storm". */
export function bareTitle(title: string): string {
  return title.replace(/\s*\([^()]*#\s*[\d.]+(?:\s*-\s*[\d.]+)?\)\s*$/, '').trim() || title.trim()
}

/** "Roberto Bolaño, Natasha Wimmer (Translator)" → ["Roberto Bolaño"]. */
function authorList(...values: (string | undefined)[]): string[] {
  const names = values
    .flatMap((v) => (v ?? '').split(','))
    .map((a) => a.trim())
    .filter((a) => a && !/\((?!author\))[^)]*\)$/i.test(a))
    .map((a) => a.replace(/\s*\(author\)$/i, ''))
  return [...new Set(names)]
}

/** Goodreads reviews are HTML; keep the words and line breaks. */
export function plainReview(value: string | undefined): string | undefined {
  const text = (value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text || undefined
}

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

const yes = (value: string | undefined) => /^(yes|true|1)$/i.test((value ?? '').trim())
const filled = (value: string | undefined) => !!value?.trim()

/** One read in StoryGraph's "Dates Read"; an open range ("2025/01/05-") has no end yet. */
export type DatedRead = { startedAt?: string; finishedAt?: string }

/** "2023/01/05-2023/01/20, 2024/02/01, 2025/03/02-" → reads, most recent first. */
export function parseDatesRead(value: string | undefined): DatedRead[] {
  const date = /\d{4}[/-]\d{1,2}[/-]\d{1,2}/g
  const reads: DatedRead[] = []
  for (const segment of (value ?? '').split(/[,;]/)) {
    const dates = (segment.match(date) ?? []).map(parseExportDate).filter((d): d is string => !!d)
    if (dates.length >= 2) reads.push({ startedAt: dates[0], finishedAt: dates[1] })
    else if (dates.length === 1) {
      // A dash after the only date leaves the range open: started, not finished.
      const open = /^[-–]$/.test(segment.replace(date, '').trim())
      reads.push(open ? { startedAt: dates[0] } : { finishedAt: dates[0] })
    }
  }
  const at = (r: DatedRead) => r.finishedAt ?? r.startedAt ?? ''
  return reads.sort((a, b) => at(b).localeCompare(at(a)))
}

/** Reads with an end date, as BookHive's `previousReads` (which need one). */
const ended = (reads: DatedRead[]): PreviousRead[] =>
  reads.flatMap((r) => (r.finishedAt ? [r.startedAt ? { startedAt: r.startedAt, finishedAt: r.finishedAt } : { finishedAt: r.finishedAt }] : []))

function goodreadsRow(r: Record<string, string>, line: number): ImportRow {
  const shelves = list(r['Bookshelves']).map((s) => s.toLowerCase())
  const exclusive = (r['Exclusive Shelf'] ?? '').toLowerCase()
  const finished = parseExportDate(r['Date Read'])
  const status =
    DNF_SHELVES.has(exclusive) || shelves.some((s) => DNF_SHELVES.has(s))
      ? STATUS.abandoned
      : exclusive === 'read'
        ? STATUS.finished
        : exclusive === 'currently-reading'
          ? STATUS.reading
          : exclusive === 'to-read'
            ? STATUS.wantToRead
            : finished
              ? STATUS.finished
              : STATUS.wantToRead
  const { stars, rounded } = toStars(r['My Rating'])
  const readCount = Number.parseInt(r['Read Count'] ?? '', 10) || 0
  const id = (r['Book Id'] ?? '').trim()
  return {
    line,
    title: r['Title']!,
    bareTitle: bareTitle(r['Title']!),
    authors: authorList(r['Author'], r['Additional Authors']),
    ...isbnsFrom(r['ISBN13'], r['ISBN']),
    ...(/^\d+$/.test(id) ? { goodreadsId: id } : {}),
    status,
    createdAt: parseExportDate(r['Date Added']),
    finishedAt: status === STATUS.finished ? finished : undefined,
    previousReads: [],
    stars,
    ratingRounded: rounded,
    review: plainReview(r['My Review']),
    owned: (Number.parseInt(r['Owned Copies'] ?? '', 10) || 0) > 0,
    shelves: list(r['Bookshelves']).filter((s) => !GOODREADS_EXCLUSIVE.has(s.toLowerCase()) && !DNF_SHELVES.has(s.toLowerCase())),
    extras: {
      moods: false,
      pace: false,
      contentWarnings: false,
      spoiler: yes(r['Spoiler']),
      // Goodreads counts re-reads but only dates the last one.
      undatedRereads: Math.max(0, readCount - 1),
    },
  }
}

function storygraphRow(r: Record<string, string>, line: number): ImportRow {
  const raw = (r['Read Status'] ?? '').toLowerCase()
  const status =
    raw === 'read'
      ? STATUS.finished
      : raw === 'currently-reading' || raw === 'paused'
        ? STATUS.reading
        : raw === 'did-not-finish'
          ? STATUS.abandoned
          : STATUS.wantToRead
  const reads = parseDatesRead(r['Dates Read'])
  const last = parseExportDate(r['Last Date Read'])
  if (!reads.length && last) reads.push({ finishedAt: last })
  const readCount = Number.parseInt(r['Read Count'] ?? '', 10) || 0
  const { stars, rounded } = toStars(r['Star Rating'])
  // The most recent read is the current one when it fits the status (finished,
  // in progress, or the attempt that was abandoned); the rest are history.
  const [latest, ...earlier] = reads
  let current: DatedRead | undefined
  let history = reads
  if (status === STATUS.finished && latest?.finishedAt) [current, history] = [latest, earlier]
  else if (status === STATUS.reading && latest && !latest.finishedAt) [current, history] = [latest, earlier]
  else if (status === STATUS.abandoned && latest) [current, history] = [{ startedAt: latest.startedAt }, earlier]
  return {
    line,
    title: r['Title']!,
    bareTitle: bareTitle(r['Title']!),
    authors: authorList(r['Authors']),
    ...isbnsFrom(r['ISBN/UID']),
    status,
    createdAt: parseExportDate(r['Date Added']),
    startedAt: current?.startedAt,
    finishedAt: status === STATUS.finished ? current?.finishedAt : undefined,
    previousReads: ended(history),
    stars,
    ratingRounded: rounded,
    review: plainReview(r['Review']),
    owned: yes(r['Owned?']),
    shelves: list(r['Tags']),
    extras: {
      moods: filled(r['Moods']),
      pace: filled(r['Pace']),
      contentWarnings: filled(r['Content Warnings']),
      spoiler: false,
      undatedRereads: Math.max(0, readCount - reads.length),
    },
  }
}

function hardcoverRow(r: Record<string, string>, line: number): ImportRow {
  const raw = (r['Status'] ?? '').toLowerCase()
  const finished = parseExportDate(r['Date Finished'])
  const status =
    raw === 'read'
      ? STATUS.finished
      : raw === 'currently reading'
        ? STATUS.reading
        : raw === 'want to read'
          ? STATUS.wantToRead
          : raw === 'stopped' || raw === 'did not finish'
            ? STATUS.abandoned
            : finished
              ? STATUS.finished
              : STATUS.wantToRead
  const { stars, rounded } = toStars(r['Rating'])
  return {
    line,
    title: r['Title']!,
    bareTitle: bareTitle(r['Title']!),
    authors: authorList(r['Author']),
    ...isbnsFrom(r['ISBN 13'], r['ISBN 10']),
    status,
    createdAt: parseExportDate(r['Date Added']),
    startedAt: status === STATUS.wantToRead ? undefined : parseExportDate(r['Date Started']),
    finishedAt: status === STATUS.finished ? finished : undefined,
    previousReads: [],
    stars,
    ratingRounded: rounded,
    review: plainReview(r['Review']),
    owned: yes(r['Owned']),
    shelves: list(r['Lists'])
      .map((s) => s.replace(/\s*\(#\d+\)$/, ''))
      .filter((s) => s.toLowerCase() !== 'owned'),
    extras: {
      moods: filled(r['Moods']),
      pace: false,
      contentWarnings: filled(r['Content Warnings']),
      spoiler: yes(r['Review Contains Spoilers']),
      undatedRereads: 0,
    },
  }
}

const ROW: Record<ImportSource, (r: Record<string, string>, line: number) => ImportRow> = {
  goodreads: goodreadsRow,
  storygraph: storygraphRow,
  hardcover: hardcoverRow,
}

/** Reads an export, or throws ImportFileError saying what's wrong with the file. */
export function parseExport(text: string): ParsedExport {
  const { headers, rows } = csvRecords(text)
  const source = detectSource(headers)
  if (!source) {
    throw new ImportFileError(
      headers.length > 1
        ? "This doesn't look like a Goodreads, StoryGraph or Hardcover library export. Export your library again and choose the CSV file."
        : "This file isn't a CSV export. Export your library again and choose the CSV file.",
    )
  }
  const parsed: ImportRow[] = []
  let skipped = 0
  rows.forEach((r, i) => {
    const title = r['Title']?.trim()
    const author = (r['Author'] ?? r['Authors'])?.trim()
    if (!title || !author) {
      skipped++
      return
    }
    parsed.push(ROW[source]({ ...r, Title: title }, i + 2))
  })
  if (!parsed.length) throw new ImportFileError(`This ${SOURCE_NAME[source]} export has no books in it.`)
  return { source, rows: parsed, skipped }
}

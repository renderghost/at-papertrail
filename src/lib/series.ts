import { mergeEditions } from './bibliography'
import type { HiveBook } from './bookhive/api'
import { firstAuthor } from './bookhive/authors'
import { parseSeries } from './bookhive/series'
import { STATUS, type BookEntry } from './bookhive/types'
import { bookKeys, libraryIndex } from './import/match'

/**
 * Series tracking (#61): a series' books in reading order, from BookHive's
 * catalogue (`series` is `{title, position}`), and where you are in it.
 * Whole-number positions are the main sequence; "1.5" and the like are
 * novellas and extras, listed but never counted as next or as gaps.
 */

export type SeriesBook = {
  book: HiveBook
  /** As the catalogue writes it: "3", "0.5", or none. */
  position?: string
  /** For ordering; unnumbered books go last. */
  order: number
  main: boolean
  /** Your copy, if you have one. */
  entry?: BookEntry
}

export type SeriesProgress = {
  books: SeriesBook[]
  /** Main-sequence books you've finished (now or before), and how many there are. */
  read: number
  total: number
  /** The first main book after the furthest one you've finished (the first book if you haven't started). */
  next?: SeriesBook
  /** Main books before the furthest one you've finished that you haven't read. */
  gaps: SeriesBook[]
}

const key = (title: string) => title.trim().toLowerCase()

export function seriesOrder(position: string | undefined): number {
  const n = Number.parseFloat(position ?? '')
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY
}

/** The series' books among an author's catalogue entries, one edition each, in reading order. */
export function booksInSeries(books: HiveBook[], title: string): HiveBook[] {
  const wanted = key(title)
  const members = books.filter((b) => {
    const s = parseSeries(b.series)
    return !!s && key(s.title) === wanted
  })
  return mergeEditions(members).sort(
    (a, b) => seriesOrder(parseSeries(a.series)?.position) - seriesOrder(parseSeries(b.series)?.position) || a.title.localeCompare(b.title),
  )
}

/** Whether you've finished a book: now, or in an earlier read. */
export function hasRead(entry: BookEntry | undefined): boolean {
  return !!entry && (entry.value.status === STATUS.finished || (entry.value.previousReads?.length ?? 0) > 0)
}

export function seriesProgress(books: HiveBook[], title: string, library: BookEntry[] = []): SeriesProgress {
  const index = libraryIndex(library)
  const list: SeriesBook[] = booksInSeries(books, title).map((book) => {
    const position = parseSeries(book.series)?.position
    const order = seriesOrder(position)
    const entry = bookKeys({ hiveId: book.id, title: book.title, authors: book.authors, identifiers: book.identifiers })
      .map((k) => index.get(k))
      .find(Boolean)
    return { book, position, order, main: Number.isInteger(order) || order === Number.POSITIVE_INFINITY, ...(entry ? { entry } : {}) }
  })
  const main = list.filter((b) => b.main)
  const furthest = Math.max(Number.NEGATIVE_INFINITY, ...main.filter((b) => hasRead(b.entry)).map((b) => b.order))
  const next = main.find((b) => b.order > furthest && !hasRead(b.entry))
  const gaps = main.filter((b) => b.order < furthest && !hasRead(b.entry) && b.entry?.value.status !== STATUS.abandoned)
  return { books: list, read: main.filter((b) => hasRead(b.entry)).length, total: main.length, ...(next ? { next } : {}), gaps }
}

/** The series a catalogue book belongs to, as the pair that finds it: its title and first author. */
export function seriesOf(book: Pick<HiveBook, 'series' | 'authors'> | null | undefined): { title: string; author: string; position?: string } | null {
  const s = book ? parseSeries(book.series) : null
  const author = book ? firstAuthor(book.authors) : ''
  return s && author ? { title: s.title, author, ...(s.position ? { position: s.position } : {}) } : null
}

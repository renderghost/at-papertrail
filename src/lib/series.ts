import { editionFor, mainLanguage, readerLanguage, seriesOrder, seriesSlots } from './bibliography'
import type { HiveBook } from './bookhive/api'
import { firstAuthor } from './bookhive/authors'
import { catalogSeries } from './bookhive/catalog'
import { parseSeries } from './bookhive/series'
import { STATUS, type BookEntry } from './bookhive/types'
import { bookKeys, libraryIndex } from './import/match'

export { seriesOrder }

/**
 * Series tracking (#61): a series' books in reading order, from BookHive's
 * catalogue (`series` is `{title, position}`), and where you are in it.
 * Whole-number positions are the main sequence; "1.5" and the like are
 * novellas and extras, and "1-4" box sets are extras too: listed, but never
 * counted as next or as gaps.
 *
 * BookHive's author listing (`hiveBook`) has no series field: only each
 * book's catalogue record does, so `withSeries` reads them in (#96).
 */

export type SeriesBook = {
  book: HiveBook
  /** As the catalogue writes it: "3", "0.5", "1-4", or none. */
  position?: string
  /** For ordering; box sets and unnumbered books go last. */
  order: number
  main: boolean
  /** Your copy, if you have one (of any edition). */
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

function membersOf(books: HiveBook[], title: string): HiveBook[] {
  const wanted = key(title)
  return books.filter((b) => {
    const s = parseSeries(b.series)
    return !!s && key(s.title) === wanted
  })
}

/** The series' books among an author's catalogue entries, one edition each, in reading order. */
export function booksInSeries(books: HiveBook[], title: string, reader = readerLanguage()): HiveBook[] {
  return seriesProgress(books, title, [], reader).books.map((b) => b.book)
}

/** Whether you've finished a book: now, or in an earlier read. */
export function hasRead(entry: BookEntry | undefined): boolean {
  return !!entry && (entry.value.status === STATUS.finished || (entry.value.previousReads?.length ?? 0) > 0)
}

/**
 * A series in reading order and your place in it. Each place shows your own
 * edition if you have one, or else one in the reader's language.
 */
export function seriesProgress(books: HiveBook[], title: string, library: BookEntry[] = [], reader = readerLanguage()): SeriesProgress {
  const index = libraryIndex(library)
  const yours = (book: HiveBook) =>
    bookKeys({ hiveId: book.id, title: book.title, authors: book.authors, identifiers: book.identifiers })
      .map((k) => index.get(k))
      .find(Boolean)
  const members = membersOf(books, title)
  const languages = [reader, mainLanguage(members)]
  const list = seriesSlots(members).map((editions): SeriesBook => {
    const owned = editions.find(yours)
    const book = owned ?? editionFor(editions, languages)
    const position = parseSeries(book.series)?.position
    const entry = owned && yours(owned)
    return { book, position, order: seriesOrder(position), main: false, ...(entry ? { entry } : {}) }
  })
  // A series with no numbers at all is read in the order it's listed.
  const numbered = list.some((b) => Number.isFinite(b.order))
  for (const b of list) b.main = Number.isInteger(b.order) || (!numbered && !b.position)
  list.sort((a, b) => a.order - b.order || a.book.title.localeCompare(b.book.title))

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

export type SeriesLookup = (hiveId: string) => Promise<string | null>

/** Books with their series filled in from their catalogue records, where the listing left it out. */
export async function withSeries(books: HiveBook[], lookup: SeriesLookup = catalogSeries): Promise<HiveBook[]> {
  const found = await Promise.all(books.map((b) => (b.series ? b.series : lookup(b.id).catch(() => null))))
  return books.map((b, i) => (!b.series && found[i] ? { ...b, series: found[i] } : b))
}

const SCAN_BATCH = 6

/**
 * Every edition of a series' book number `position`, reading catalogue
 * records only as far as needed. An author's books arrive most popular first,
 * sequels are rarely far down, and editions of one book have near-identical
 * ratings (Goodreads counts them per work), so once one turns up the rest are
 * next to it. Far cheaper than reading the whole list, for "continue a series".
 */
export async function findInSeries(books: HiveBook[], title: string, position: number, lookup: SeriesLookup = catalogSeries): Promise<HiveBook[]> {
  const found: HiveBook[] = []
  let floor = -1
  for (let i = 0; i < books.length; i += SCAN_BATCH) {
    const batch = books.slice(i, i + SCAN_BATCH)
    if (floor >= 0 && (batch[0]!.ratingsCount ?? 0) < floor) break
    for (const book of membersOf(await withSeries(batch, lookup), title)) {
      if (seriesOrder(parseSeries(book.series)?.position) !== position) continue
      found.push(book)
      if (floor < 0) floor = (book.ratingsCount ?? 0) * 0.95
    }
  }
  return found
}

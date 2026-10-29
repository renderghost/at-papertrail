import type { HiveBook } from '../bookhive/api'
import { firstAuthor } from '../bookhive/authors'
import { getHiveId } from '../bookhive/hiveId'
import type { BookEntry, CatalogBook } from '../bookhive/types'
import { isbn10To13, isbn13To10 } from '../isbn'
import { bookKey } from '../search'
import { createLimiter } from '../pool'
import type { ImportRow } from './sources'

/**
 * Finds each imported row's book, cheapest first:
 * 1. your own library (no network, so a re-run after an interruption is quick)
 * 2. BookHive's catalogue by ISBN
 * 3. the hiveId BookHive would compute from the Goodreads-style bare title and
 *    first author, checked against @bookhive.buzz's PDS
 * 4. BookHive's search, which also supplies suggestions when nothing matches
 */

export type RowMatch =
  | { kind: 'library'; entry: BookEntry }
  | { kind: 'catalogue'; book: CatalogBook; via: 'isbn' | 'title' | 'search' }
  | { kind: 'unmatched'; suggestions: HiveBook[] }

export type MatchDeps = {
  /**
   * A catalogue entry by hiveId, or null. `known` means BookHive's own lookup
   * returned this id, so it's worth asking BookHive's API when @bookhive.buzz
   * hasn't published the catalogue record yet.
   */
  catalogue: (hiveId: string, signal?: AbortSignal, known?: boolean) => Promise<CatalogBook | null>
  hiveIdForIsbn: (isbn: string, signal?: AbortSignal) => Promise<string | null>
  search: (q: string, signal?: AbortSignal) => Promise<HiveBook[]>
}

/** Every key a book is known by: ISBNs (both forms), hiveId, Goodreads id, and title with first author. */
export function bookKeys(book: {
  hiveId?: string
  title: string
  authors: string
  identifiers?: { isbn10?: string; isbn13?: string; goodreadsId?: string }
}): string[] {
  const keys = [`t:${bookKey(book.title, firstAuthor(book.authors))}`]
  if (book.hiveId) keys.push(`h:${book.hiveId}`)
  // A re-imported Goodreads row finds its book even after you matched it to a differently titled one.
  if (book.identifiers?.goodreadsId) keys.push(`g:${book.identifiers.goodreadsId}`)
  const { isbn10, isbn13 } = book.identifiers ?? {}
  for (const isbn of [isbn13, isbn10, isbn13 && isbn13To10(isbn13), isbn10 && isbn10To13(isbn10)]) if (isbn) keys.push(`i:${isbn}`)
  return keys
}

/** The ids BookHive could have for a row: from the bare title first, then the full title. */
export function computedHiveIds(row: Pick<ImportRow, 'title' | 'bareTitle' | 'authors'>): string[] {
  const author = row.authors[0] ?? ''
  return [...new Set([row.bareTitle, row.title].map((title) => getHiveId({ title, authors: author })))]
}

/** Your library indexed by every key, so a row finds its entry without a request. */
export function libraryIndex(entries: BookEntry[]): Map<string, BookEntry> {
  const index = new Map<string, BookEntry>()
  for (const entry of entries) {
    for (const key of bookKeys({ ...entry.value, hiveId: entry.value.hiveId })) if (!index.has(key)) index.set(key, entry)
  }
  return index
}

export function rowKeys(row: ImportRow): string[] {
  const authors = row.authors.join('\t')
  return [
    ...computedHiveIds(row).map((id) => `h:${id}`),
    ...bookKeys({ title: row.bareTitle, authors, identifiers: row }),
    `t:${bookKey(row.title, row.authors[0])}`,
  ]
}

export function findInLibrary(row: ImportRow, index: Map<string, BookEntry>): BookEntry | null {
  for (const key of rowKeys(row)) {
    const entry = index.get(key)
    if (entry) return entry
  }
  return null
}

function sameBook(row: ImportRow, book: HiveBook): boolean {
  const first = row.authors[0]
  const keys = new Set([bookKey(row.bareTitle, first), bookKey(row.title, first)])
  if (keys.has(bookKey(book.title, firstAuthor(book.authors)))) return true
  const ids = book.identifiers ?? {}
  return (!!row.isbn13 && ids.isbn13 === row.isbn13) || (!!row.isbn10 && ids.isbn10 === row.isbn10)
}

export async function matchRow(
  row: ImportRow,
  index: Map<string, BookEntry>,
  deps: MatchDeps,
  signal?: AbortSignal,
): Promise<RowMatch> {
  const entry = findInLibrary(row, index)
  if (entry) return { kind: 'library', entry }

  for (const isbn of [row.isbn13, row.isbn10]) {
    if (!isbn) continue
    const hiveId = await deps.hiveIdForIsbn(isbn, signal).catch(() => null)
    const book = hiveId ? await deps.catalogue(hiveId, signal, true).catch(() => null) : null
    if (book) return { kind: 'catalogue', book, via: 'isbn' }
  }

  for (const hiveId of computedHiveIds(row)) {
    const book = await deps.catalogue(hiveId, signal).catch(() => null)
    if (book) return { kind: 'catalogue', book, via: 'title' }
  }

  const results = await deps.search(`${row.bareTitle} ${row.authors[0] ?? ''}`.trim(), signal).catch(() => [] as HiveBook[])
  const hit = results.find((b) => sameBook(row, b))
  if (hit) return { kind: 'catalogue', book: hit, via: 'search' }
  return { kind: 'unmatched', suggestions: results.slice(0, 5) }
}

/** Matches every row, four at a time, reporting how many are done. */
export async function matchAll(
  rows: ImportRow[],
  index: Map<string, BookEntry>,
  deps: MatchDeps,
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (done: number) => void } = {},
): Promise<Map<number, RowMatch>> {
  const limit = createLimiter(4)
  const out = new Map<number, RowMatch>()
  let done = 0
  await Promise.all(
    rows.map((row) =>
      limit(async () => {
        if (signal?.aborted) return
        out.set(row.line, await matchRow(row, index, deps, signal))
        onProgress?.(++done)
      }),
    ),
  )
  if (signal?.aborted) throw new DOMException('Matching was cancelled.', 'AbortError')
  return out
}

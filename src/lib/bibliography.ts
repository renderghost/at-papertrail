import { firstAuthor } from './bookhive/authors'
import { parseSeries } from './bookhive/series'
import type { CatalogBook } from './bookhive/types'
import { normaliseTitle } from './search'

/** "Jonathan Strange & Mr. Norrell: A Novel" and "… by Susanna Clarke" are one work. */
export function workKey(title: string): string {
  const base = title
    .replace(/\s+by\s+[^:()]+$/i, '')
    .split(/[:(]/)[0]!
    .replace(/&/g, ' and ')
  return normaliseTitle(base)
}

/** One entry per work: the edition with the most ratings stands for the rest. */
export function mergeEditions<T extends Pick<CatalogBook, 'title' | 'ratingsCount'>>(books: T[]): T[] {
  const best = new Map<string, T>()
  for (const book of books) {
    const key = workKey(book.title)
    const current = best.get(key)
    if (!current || (book.ratingsCount ?? 0) > (current.ratingsCount ?? 0)) best.set(key, book)
  }
  return books.filter((b) => best.get(workKey(b.title)) === b)
}

export type SeriesGroup<T> = { series: string; books: T[] }

/** Series first (in reading order), then standalone books by year, newest first. */
export function groupBibliography<T extends Pick<CatalogBook, 'series' | 'publicationYear' | 'title'>>(
  books: T[],
): { series: SeriesGroup<T>[]; standalone: T[] } {
  const groups = new Map<string, { position: number; book: T }[]>()
  const standalone: T[] = []
  for (const book of books) {
    const s = parseSeries(book.series)
    if (!s) {
      standalone.push(book)
      continue
    }
    const position = Number.parseFloat(s.position ?? '')
    const list = groups.get(s.title) ?? []
    list.push({ position: Number.isFinite(position) ? position : Number.POSITIVE_INFINITY, book })
    groups.set(s.title, list)
  }
  const series = [...groups.entries()].map(([name, list]) => ({
    series: name,
    books: list.sort((a, b) => a.position - b.position).map((x) => x.book),
  }))
  standalone.sort((a, b) => (b.publicationYear ?? 0) - (a.publicationYear ?? 0))
  return { series, standalone }
}

/** Whether a library book is by `author` (any credited author, ignoring case and accents). */
export function isBy(authors: string, author: string): boolean {
  const wanted = normaliseTitle(author)
  return authors.split('\t').some((a) => normaliseTitle(a) === wanted) || normaliseTitle(firstAuthor(authors)) === wanted
}

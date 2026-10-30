import { firstAuthor } from './bookhive/authors'
import { parseSeries } from './bookhive/series'
import type { CatalogBook } from './bookhive/types'
import { normaliseTitle } from './search'

/** "Jonathan Strange & Mr. Norrell: A Novel", "… by Susanna Clarke" and "… by Clarke, Susanna ( Author )" are one work. */
export function workKey(title: string): string {
  const base = title
    .split(/[:(]/)[0]!
    .replace(/\s+by\s+.+$/i, '')
    .replace(/&/g, ' and ')
  return normaliseTitle(base)
}

type Edition = Pick<CatalogBook, 'title' | 'ratingsCount'>

/**
 * The edition that stands for several. Goodreads counts ratings per work, so
 * editions of one book come within a whisker of each other; among those, the
 * plainest title wins ("The Dispossessed" over "The Dispossessed by Le Guin,
 * Ursula K. ( Author ) ON Aug-12-…"). `prefer` narrows the field first.
 */
export function bestEdition<T extends Edition>(editions: T[], prefer?: (book: T) => boolean): T {
  const preferred = prefer ? editions.filter(prefer) : []
  const pool = preferred.length ? preferred : editions
  const most = Math.max(0, ...pool.map((b) => b.ratingsCount ?? 0))
  return pool
    .filter((b) => (b.ratingsCount ?? 0) >= most * 0.95)
    .reduce((best, b) => (b.title.length < best.title.length ? b : best))
}

/** One entry per work, in the order given. */
export function mergeEditions<T extends Edition>(books: T[]): T[] {
  const works = new Map<string, T[]>()
  for (const book of books) {
    const key = workKey(book.title)
    works.set(key, [...(works.get(key) ?? []), book])
  }
  const best = new Set([...works.values()].map((editions) => bestEdition(editions)))
  return books.filter((b) => best.has(b))
}

/** A place in a series as a number: "3" and "1.5" are; "1-4" (a box set) and none are not, so they sort last. */
export function seriesOrder(position: string | undefined): number {
  const p = position?.trim() ?? ''
  return /^\d+(\.\d+)?$/.test(p) ? Number(p) : Number.POSITIVE_INFINITY
}

type Member = Edition & Pick<CatalogBook, 'series' | 'language'>

/**
 * A series' books grouped by their place in it: reprints and translations of
 * book 2 are one book 2, and every "1-4" box set is one box set. Unnumbered
 * books group by title.
 */
export function seriesSlots<T extends Member>(members: T[]): T[][] {
  const slots = new Map<string, T[]>()
  for (const book of members) {
    const position = parseSeries(book.series)?.position
    const order = seriesOrder(position)
    const key = Number.isFinite(order) ? `n:${order}` : position ? `p:${position}` : `w:${workKey(book.title)}`
    slots.set(key, [...(slots.get(key) ?? []), book])
  }
  return [...slots.values()]
}

/** The reader's language as BookHive names languages ("English"), from the browser's settings. */
export function readerLanguage(tags: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages): string | undefined {
  for (const tag of tags) {
    try {
      const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(tag.split('-')[0]!)
      if (name) return name
    } catch {
      // Not a language tag.
    }
  }
  return undefined
}

/** BookHive writes ISO names, some with alternatives ("Spanish; Castilian"). */
export function inLanguage(book: Pick<CatalogBook, 'language'>, language: string | undefined): boolean {
  return !!language && book.language?.split(';')[0]?.trim().toLowerCase() === language.toLowerCase()
}

/** The language most of a series' editions are in, as far as the catalogue says. */
export function mainLanguage(members: Pick<CatalogBook, 'language'>[]): string | undefined {
  const counts = new Map<string, number>()
  for (const b of members) {
    const name = b.language?.split(';')[0]?.trim()
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
}

/**
 * The edition to show for one place in a series: one in the first of
 * `languages` it comes in, else one with no language recorded (more often
 * the original than a translation), else the best of the rest.
 */
export function editionFor<T extends Edition & Pick<CatalogBook, 'language'>>(editions: T[], languages: (string | undefined)[]): T {
  for (const language of languages) {
    const pool = editions.filter((b) => inLanguage(b, language))
    if (pool.length) return commonest(pool)
  }
  const unknown = editions.filter((b) => !b.language)
  return commonest(unknown.length ? unknown : editions)
}

/** The edition with the title most editions agree on, so a misspelt one ("The Dispossed") never stands for the rest. */
function commonest<T extends Edition>(editions: T[]): T {
  const works = new Map<string, T[]>()
  for (const b of editions) works.set(workKey(b.title), [...(works.get(workKey(b.title)) ?? []), b])
  const ratings = (group: T[]) => Math.max(...group.map((b) => b.ratingsCount ?? 0))
  const [agreed] = [...works.values()].sort((a, b) => b.length - a.length || ratings(b) - ratings(a))
  return bestEdition(agreed!)
}

export type SeriesGroup<T> = { series: string; books: T[] }

/**
 * An author's books, every edition as listed: series first (in reading order,
 * one edition per place), then the other works by year, newest first. A work
 * with any edition in a series is left out of the rest.
 */
export function groupBibliography<T extends Member & Pick<CatalogBook, 'publicationYear'>>(
  books: T[],
  reader = readerLanguage(),
): { series: SeriesGroup<T>[]; standalone: T[] } {
  const groups = new Map<string, T[]>()
  const rest: T[] = []
  for (const book of books) {
    const s = parseSeries(book.series)
    if (s) groups.set(s.title, [...(groups.get(s.title) ?? []), book])
    else rest.push(book)
  }
  const inSeries = new Set([...groups.values()].flat().map((b) => workKey(b.title)))
  const standalone = mergeEditions(rest.filter((b) => !inSeries.has(workKey(b.title))))
  const series = [...groups.entries()].map(([name, members]) => {
    const languages = [reader, mainLanguage(members)]
    const picks = seriesSlots(members).map((editions) => editionFor(editions, languages))
    const order = (b: T) => seriesOrder(parseSeries(b.series)?.position)
    return { series: name, books: picks.sort((a, b) => order(a) - order(b)) }
  })
  standalone.sort((a, b) => (b.publicationYear ?? 0) - (a.publicationYear ?? 0))
  return { series, standalone }
}

/** Whether a library book is by `author` (any credited author, ignoring case and accents). */
export function isBy(authors: string, author: string): boolean {
  const wanted = normaliseTitle(author)
  return authors.split('\t').some((a) => normaliseTitle(a) === wanted) || normaliseTitle(firstAuthor(authors)) === wanted
}

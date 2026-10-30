import type { Profile } from './atproto'
import { distinctWorks } from './bibliography'
import { sameBookKeys } from './bookclub'
import type { HiveBook } from './bookhive/api'
import { displayAuthors, firstAuthor } from './bookhive/authors'
import { STATUS, type BookEntry, type BookIdentifiers } from './bookhive/types'
import { displayName } from './format'
import { bookKey } from './search'
import { LOVED, type Twin } from './taste'

/**
 * "Because you loved X" (#71): books like the ones you rated highest, from
 * their authors, from the people most like you, and from their genres.
 * Every pick says why. Worked out in the browser.
 */

/** Four and a half stars and up. */
export const SEED_STARS = 9

/** Genres too broad to say anything about a book. */
const BROAD = new Set(['fiction', 'nonfiction', 'audiobook', 'novels', 'classics', 'literature', 'adult', 'adult fiction', 'book club', 'kindle'])

export type Recommendation = {
  hiveId: string
  title: string
  authors: string
  identifiers?: BookIdentifiers
  catalog: HiveBook | null
  why: string
  seed: BookEntry
}

/** Your best-loved books, most recently finished first. */
export function seedsFrom(library: BookEntry[], limit = 6): BookEntry[] {
  return library
    .filter((e) => (e.value.stars ?? 0) >= SEED_STARS)
    .sort((a, b) => (b.value.finishedAt ?? b.value.createdAt).localeCompare(a.value.finishedAt ?? a.value.createdAt))
    .slice(0, limit)
}

/** The most telling genre of a book: the first that isn't a catch-all. */
export function telling(genres: string[] | undefined): string | undefined {
  return genres?.find((g) => !BROAD.has(g.trim().toLowerCase()))
}

/** Box sets and omnibus editions: a recommendation should be one book. */
const COLLECTION = /\b(trilogy|quartet|quintet|box(ed)? set|omnibus|collection|the complete|books? \d+\s*[-–&]\s*\d+|volumes? \d+\s*[-–]\s*\d+)\b/i
export const isCollection = (title: string) => COLLECTION.test(title)

const stars = (n: number) => `${(n / 2).toLocaleString('en-GB')} ${n === 2 ? 'star' : 'stars'}`

export type Sources = {
  /** The seed author's books on BookHive. */
  byAuthor?: HiveBook[]
  /** Popular books in the seed's telling genre. */
  genre?: { name: string; books: HiveBook[] }
}

/** Keys for "you already have it, or said it's not for you". */
export function excluded(library: BookEntry[], notForMe: Iterable<string>): Set<string> {
  const keys = new Set(library.flatMap(sameBookKeys))
  for (const hiveId of notForMe) keys.add(`hive:${hiveId}`)
  return keys
}

const keysOf = (b: { hiveId: string; title: string; authors: string; identifiers?: BookIdentifiers }) => {
  const keys = [`hive:${b.hiveId}`, `title:${bookKey(b.title, firstAuthor(b.authors))}`]
  if (b.identifiers?.isbn13) keys.push(`isbn:${b.identifiers.isbn13}`)
  return keys
}

/**
 * Up to `perSeed` picks for one seed: the people most like you who also
 * loved it first (their favourites), then the seed's author, then its genre.
 */
export function recommendFor<R extends { profile: Profile; books: BookEntry[] }>(
  seed: BookEntry,
  { byAuthor = [], genre }: Sources,
  twins: Twin<R>[],
  skip: Set<string>,
  { perSeed = 4, reader }: { perSeed?: number; reader?: string } = {},
): Recommendation[] {
  const picks: Recommendation[] = []
  const taken = new Set(skip)
  const seedKeys = new Set(sameBookKeys(seed))
  const take = (r: Omit<Recommendation, 'seed'>): boolean => {
    const keys = keysOf(r)
    if (picks.length >= perSeed || keys.some((k) => taken.has(k) || seedKeys.has(k))) return false
    keys.forEach((k) => taken.add(k))
    picks.push({ ...r, seed })
    return true
  }
  const seedTitle = seed.value.title

  for (const { reader: twin, match } of twins) {
    if ((match.score ?? 0) < 60) continue
    const theirSeed = twin.books.find((b) => sameBookKeys(b).some((k) => seedKeys.has(k)))
    if ((theirSeed?.value.stars ?? 0) < LOVED) continue
    // Their two best-loved books you don't have.
    let fromThem = 0
    for (const b of twin.books.filter((x) => (x.value.stars ?? 0) >= LOVED).sort((x, y) => (y.value.stars ?? 0) - (x.value.stars ?? 0))) {
      if (fromThem >= 2) break
      if (b.value.status === STATUS.abandoned) continue
      const took = take({
        hiveId: b.value.hiveId,
        title: b.value.title,
        authors: b.value.authors,
        ...(b.value.identifiers ? { identifiers: b.value.identifiers } : {}),
        catalog: null,
        why: `${displayName(twin.profile)} (${match.score}% match) loved ${seedTitle} too, and gave this ${stars(b.value.stars!)}`,
      })
      if (took) fromThem++
    }
  }

  const author = firstAuthor(seed.value.authors)
  for (const b of distinctWorks(byAuthor, reader).slice(0, 12)) {
    if (isCollection(b.title)) continue
    take({ hiveId: b.id, title: b.title, authors: b.authors, ...(b.identifiers ? { identifiers: b.identifiers } : {}), catalog: b, why: `Because you gave ${seedTitle} ${stars(seed.value.stars!)}: more from ${displayAuthors(author)}` })
  }

  if (genre) {
    for (const b of distinctWorks(genre.books, reader).slice(0, 20)) {
      if (firstAuthor(b.authors) === author || isCollection(b.title)) continue
      take({ hiveId: b.id, title: b.title, authors: b.authors, ...(b.identifiers ? { identifiers: b.identifiers } : {}), catalog: b, why: `Because you loved ${seedTitle}: among the most-read ${genre.name.toLowerCase()} on BookHive` })
    }
  }
  return picks
}

const NOT_FOR_ME = 'papertrail-not-for-me:'

/** Books you've waved away, kept in this browser only. */
export function loadNotForMe(did: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(NOT_FOR_ME + did) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function saveNotForMe(did: string, hiveIds: string[]): void {
  try {
    localStorage.setItem(NOT_FOR_ME + did, JSON.stringify(hiveIds.slice(-500)))
  } catch {
    // Private mode: it just won't be remembered.
  }
}

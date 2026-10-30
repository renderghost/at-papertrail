import type { Profile } from './atproto'
import { distinctWorks } from './bibliography'
import { sameBookKeys } from './bookclub'
import type { HiveBook } from './bookhive/api'
import { displayAuthors, firstAuthor } from './bookhive/authors'
import { STATUS, type BookEntry, type BookIdentifiers } from './bookhive/types'
import { displayName } from './format'
import { bookKey } from './search'
import { LOVED, theirRating, type ReaderLike, type Twin } from './taste'

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

export type NetworkPick = {
  /** The copy to show: from the reader most like you who has it. */
  book: BookEntry
  /** Who loved it, most like you first, with their match where it's known. */
  readers: { profile: Profile; stars: number; match: number | null }[]
}

/** The same book from different readers, once, with everyone who loved it. */
function gather(found: { book: BookEntry; reader: NetworkPick['readers'][number] }[]): NetworkPick[] {
  const picks: NetworkPick[] = []
  const byKey = new Map<string, NetworkPick>()
  for (const { book, reader } of found) {
    const keys = sameBookKeys(book)
    let pick = keys.map((k) => byKey.get(k)).find(Boolean)
    if (!pick) picks.push((pick = { book, readers: [] }))
    if (!pick.readers.some((r) => r.profile.did === reader.profile.did)) pick.readers.push(reader)
    for (const k of keys) byKey.set(k, pick)
  }
  return picks
}

const average = (p: NetworkPick) => p.readers.reduce((sum, r) => sum + r.stars, 0) / p.readers.length

/**
 * Popular with readers like you (#104): the books the people most like you
 * loved that you don't have. A book rises with every one of them who loved
 * it, the more alike the higher; any one reader's own favourites are kept
 * to a few, so no single person fills the page.
 */
export function popularWithTwins<R extends ReaderLike & { profile: Profile }>(
  twins: Twin<R>[],
  skip: Set<string>,
  { minMatch = 60, perReader = 3, limit = 20 }: { minMatch?: number; perReader?: number; limit?: number } = {},
): NetworkPick[] {
  const found: Parameters<typeof gather>[0] = []
  for (const { reader, match } of twins) {
    if (match.score === null || match.score < minMatch) continue
    for (const book of match.theirPicks) {
      if (book.value.status === STATUS.abandoned || isCollection(book.value.title)) continue
      if (sameBookKeys(book).some((k) => skip.has(k))) continue
      found.push({ book, reader: { profile: reader.profile, stars: theirRating(book, reader.reviews ?? [])!, match: match.score } })
    }
  }
  const weight = (p: NetworkPick) => p.readers.reduce((sum, r) => sum + r.match!, 0)
  const ranked = gather(found).sort((a, b) => weight(b) - weight(a) || average(b) - average(a))
  const alone = new Map<string, number>()
  return ranked
    .filter((p) => {
      if (p.readers.length > 1) return true
      const did = p.readers[0]!.profile.did
      alone.set(did, (alone.get(did) ?? 0) + 1)
      return alone.get(did)! <= perReader
    })
    .slice(0, limit)
}

/** Loved by people you follow (#79, #104): four stars and up since `since`, that you don't have; the most readers first. */
export function lovedInNetwork<R extends { profile: Profile; books: BookEntry[] }>(
  readers: R[],
  skip: Set<string>,
  { myDid, since, limit = 20 }: { myDid?: string; since: string; limit?: number },
): NetworkPick[] {
  const found: Parameters<typeof gather>[0] = []
  for (const reader of readers) {
    if (reader.profile.did === myDid) continue
    for (const book of reader.books) {
      const v = book.value
      if ((v.stars ?? 0) < LOVED || v.status === STATUS.abandoned || (v.finishedAt ?? v.createdAt) < since || isCollection(v.title)) continue
      if (sameBookKeys(book).some((k) => skip.has(k))) continue
      found.push({ book, reader: { profile: reader.profile, stars: v.stars!, match: null } })
    }
  }
  return gather(found)
    .sort((a, b) => b.readers.length - a.readers.length || average(b) - average(a))
    .slice(0, limit)
}

/** "Loved by Erin (84% match) and 2 others". */
export function lovedBy(pick: NetworkPick): string {
  const [first, ...rest] = pick.readers
  const match = first!.match !== null ? ` (${first!.match}% match)` : ''
  return `Loved by ${displayName(first!.profile)}${match}${rest.length ? ` and ${rest.length} ${rest.length === 1 ? 'other' : 'others'}` : ''}`
}

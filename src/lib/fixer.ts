import { firstAuthor, parseAuthors } from './bookhive/authors'
import { catalogUri } from './bookhive/catalog'
import { isBookStatus, STATUS, type BookEntry, type BookRecord, type CatalogBook } from './bookhive/types'
import { bookKeys } from './import/match'
import { fillGaps } from './import/plan'
import type { ImportRow } from './import/sources'

/**
 * The match fixer (#60): books BookHive's catalogue doesn't know (bookhive.buzz
 * ignores them until they're matched), and the same book in your library twice.
 */

/** Groups of entries that are the same book: same hiveId, ISBN, or title and first author. */
export function findDuplicates(entries: BookEntry[]): BookEntry[][] {
  const parent = entries.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
  const owner = new Map<string, number>()
  entries.forEach((e, i) => {
    for (const key of bookKeys(e.value)) {
      const j = owner.get(key)
      if (j === undefined) owner.set(key, i)
      else parent[find(i)] = find(j)
    }
  })
  const groups = new Map<number, BookEntry[]>()
  entries.forEach((e, i) => {
    const root = find(i)
    groups.set(root, [...(groups.get(root) ?? []), e])
  })
  return [...groups.values()].filter((g) => g.length > 1)
}

const richness = (r: BookRecord) =>
  (r.hiveBookUri ? 100 : 0) + (r.review?.trim() ? 8 : 0) + (r.stars ? 4 : 0) + (r.previousReads?.length ?? 0) + (r.finishedAt ? 2 : 0) + (r.startedAt ? 1 : 0)

/** The entry to keep: catalogued first, then the one with most of your reading in it, then the oldest. */
export function choosePrimary(group: BookEntry[]): BookEntry {
  return [...group].sort((a, b) => richness(b.value) - richness(a.value) || a.value.createdAt.localeCompare(b.value.createdAt))[0]!
}

/** A record seen as an imported row, so merging follows the import's fill-gaps rules exactly. */
function asRow(record: BookRecord): ImportRow {
  return {
    line: 0,
    title: record.title,
    bareTitle: record.title,
    authors: parseAuthors(record.authors),
    ...record.identifiers,
    status: isBookStatus(record.status) ? record.status : STATUS.wantToRead,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    previousReads: record.previousReads ?? [],
    stars: record.stars,
    ratingRounded: false,
    review: record.review,
    owned: !!record.owned,
    shelves: [],
    extras: { moods: false, pace: false, contentWarnings: false, spoiler: false, undatedRereads: 0 },
  }
}

/** The kept record with everything the others add: reads, rating, review, owned, ISBNs. */
export function mergeRecords(primary: BookRecord, others: BookRecord[]): BookRecord {
  return others.reduce((next, other) => {
    const merged = fillGaps(next, asRow(other)).next
    // An earlier date added is the truer one.
    return other.createdAt < merged.createdAt ? { ...merged, createdAt: other.createdAt } : merged
  }, primary)
}

/** The record pointed at a catalogue book instead, keeping your reading exactly as it was. */
export function rematchRecord(record: BookRecord, book: CatalogBook): BookRecord {
  return {
    ...record,
    title: book.title,
    authors: book.authors,
    hiveId: book.id,
    identifiers: { ...record.identifiers, ...book.identifiers, hiveId: book.id },
    hiveBookUri: catalogUri(book.id),
  }
}

/** What to search BookHive for to rematch a record. */
export const rematchQuery = (record: BookRecord) => `${record.title} ${firstAuthor(record.authors)}`.trim()

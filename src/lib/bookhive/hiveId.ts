import { objectHash, sha256base64 } from 'ohash'

/**
 * BookHive's book id, reproduced exactly (`src/scrapers/getHiveId.ts` upstream).
 * It must stay on ohash 1.x: v2 serialises objects differently, which would
 * produce ids that match nothing in the catalogue.
 *
 * BookHive hashes the Goodreads "bare" title (title plus subtitle, without the
 * series suffix) with the *first* author only.
 */
export function getHiveId({ title, authors }: { title: string; authors: string }): string {
  return `bk_${sha256base64(
    objectHash({
      title: title.toLowerCase(),
      author: authors.toLowerCase(),
    }),
  ).slice(0, 20)}`
}

export const HIVE_ID_PATTERN = /^bk_[A-Za-z0-9]+$/

export function isHiveId(value: unknown): value is string {
  return typeof value === 'string' && HIVE_ID_PATTERN.test(value)
}

/**
 * The ids a book found elsewhere could have in BookHive, most likely first:
 * "Title: Subtitle" (how Goodreads spells the bare title), then the title alone.
 */
export function hiveIdCandidates(book: {
  title: string
  subtitle?: string
  firstAuthor: string
}): string[] {
  const title = book.title.trim()
  const subtitle = book.subtitle?.trim()
  const titles = subtitle ? [`${title}: ${subtitle}`, title] : [title]
  return [...new Set(titles.map((t) => getHiveId({ title: t, authors: book.firstAuthor.trim() })))]
}

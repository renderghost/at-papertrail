import { listAllRecords, type RawRecord } from './atproto'
import { parseAuthors } from './bookhive/authors'
import { STATUS, type BookRecord } from './bookhive/types'
import { toCsv } from './csv'
import { resolvePds } from './identity'
import type { BookList } from './lists'

/**
 * Taking your data out (#58), entirely in the browser:
 * - JSON: your exact records in every BookHive and PopFeed collection on your
 *   PDS, for backup or another app
 * - CSV in Goodreads' layout, which Goodreads and StoryGraph both import
 */

/** Collections the JSON export covers: BookHive's and PopFeed's, whatever they add later. */
export const EXPORT_PREFIXES = ['buzz.bookhive.', 'social.popfeed.']

export type JsonExport = {
  exportedBy: 'Papertrail'
  exportedAt: string
  did: string
  handle?: string
  pds: string
  collections: Record<string, RawRecord<unknown>[]>
}

/** Every record in your BookHive and PopFeed collections, exactly as stored. */
export async function exportRecords(did: string, handle: string | undefined, signal?: AbortSignal): Promise<JsonExport> {
  const pds = await resolvePds(did)
  const res = await fetch(`${pds}/xrpc/com.atproto.repo.describeRepo?repo=${encodeURIComponent(did)}`, { signal })
  if (!res.ok) throw new Error(`Couldn't list the collections on your PDS (HTTP ${res.status}).`)
  const { collections = [] } = (await res.json()) as { collections?: string[] }
  const wanted = collections.filter((c) => EXPORT_PREFIXES.some((p) => c.startsWith(p))).sort()
  const out: JsonExport = { exportedBy: 'Papertrail', exportedAt: new Date().toISOString(), did, ...(handle ? { handle } : {}), pds, collections: {} }
  for (const collection of wanted) {
    const { records, complete } = await listAllRecords<unknown>(pds, did, collection, { maxPages: 1000, signal })
    if (!complete) throw new Error(`Couldn't read all of ${collection} from your PDS. Try again.`)
    out.collections[collection] = records
  }
  return out
}

export const GOODREADS_COLUMNS = [
  'Book Id',
  'Title',
  'Author',
  'Author l-f',
  'Additional Authors',
  'ISBN',
  'ISBN13',
  'My Rating',
  'Average Rating',
  'Publisher',
  'Binding',
  'Number of Pages',
  'Year Published',
  'Original Publication Year',
  'Date Read',
  'Date Added',
  'Bookshelves',
  'Bookshelves with positions',
  'Exclusive Shelf',
  'My Review',
  'Spoiler',
  'Private Notes',
  'Read Count',
  'Owned Copies',
] as const

const EXCLUSIVE: Record<string, string> = {
  [STATUS.finished]: 'read',
  [STATUS.reading]: 'currently-reading',
  [STATUS.wantToRead]: 'to-read',
  [STATUS.abandoned]: 'did-not-finish',
}

/** "2025-02-15T…" → "2025/02/15", as Goodreads writes dates. */
const goodreadsDate = (iso: string | undefined) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).replace(/-/g, '/') : '')

/** "Ursula K. Le Guin" → "Le Guin, Ursula K." (particles like "Le" stay with the surname when capitalised as Goodreads does). */
export function lastFirst(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length < 2) return name.trim()
  let i = parts.length - 1
  while (i > 1 && /^(de|da|del|der|di|du|la|le|van|von|bin|ibn)$/i.test(parts[i - 1]!)) i--
  return `${parts.slice(i).join(' ')}, ${parts.slice(0, i).join(' ')}`
}

/** Goodreads shelf names are lower-case with hyphens. */
export const shelfName = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')

/** Your library as a Goodreads CSV. Half stars round down: Goodreads only takes whole stars. */
export function goodreadsCsv(books: BookRecord[], lists: BookList[] = []): string {
  const shelvesFor = (book: BookRecord) =>
    lists
      .filter((l) => l.items.some((i) => i.value.identifiers.hiveId === book.hiveId))
      .map((l) => shelfName(l.value.name))
      .filter(Boolean)
  const rows = books.map((b) => {
    const [first = '', ...others] = parseAuthors(b.authors)
    const status = b.status ?? STATUS.wantToRead
    const exclusive = EXCLUSIVE[status] ?? 'to-read'
    const shelves = [...new Set([...(status === STATUS.abandoned ? [exclusive] : []), ...shelvesFor(b)])]
    const reads = (status === STATUS.finished && b.finishedAt ? 1 : 0) + (b.previousReads?.length ?? 0)
    return [
      b.identifiers?.goodreadsId ?? '',
      b.title,
      first,
      first ? lastFirst(first) : '',
      others.join(', '),
      `="${b.identifiers?.isbn10 ?? ''}"`,
      `="${b.identifiers?.isbn13 ?? ''}"`,
      b.stars ? Math.floor(b.stars / 2) : 0,
      '',
      '',
      '',
      '',
      '',
      '',
      status === STATUS.finished ? goodreadsDate(b.finishedAt) : '',
      goodreadsDate(b.createdAt),
      shelves.join(', '),
      '',
      exclusive,
      b.review ?? '',
      '',
      '',
      reads,
      b.owned ? 1 : 0,
    ]
  })
  return toCsv([[...GOODREADS_COLUMNS], ...rows])
}

/** Saves text as a file through the browser's own download. */
export function download(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

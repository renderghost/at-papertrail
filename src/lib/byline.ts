import { blobUrl, getRecord, listAllRecords, listReposWithCollection, rkeyOf } from './atproto'
import { blobCid, type BlobRef } from './bookhive/types'
import { indexedDbStore, type KeyValueStore } from './cache'
import { resolvePds } from './identity'
import { isbnKeys } from './isbn'
import { createLimiter } from './pool'

/**
 * Byline (byline.pub): author-signed book records and author profiles, CC0
 * lexicons published by Byline itself (`com.atproto.lexicon.schema` on
 * did:plc:ppjep63wzgs57unhrdcxqttm). Its book records carry BookHive's hiveId,
 * so they match the catalogue directly. Byline is small (a handful of author
 * repos in October 2026), so the whole directory is read once and cached.
 */

export const BYLINE_BOOK = 'pub.byline.book'
export const BYLINE_PROFILE = 'pub.byline.profile'

export type BylineLink = {
  url: string
  kind?: string
  label?: string
  primary?: boolean
  retailer?: string
  isAffiliate?: boolean
}

export type BylineEdition = {
  format: string
  isbn10?: string
  isbn13?: string
  pageCount?: number
  publisher?: string
  releaseDate?: string
  durationMinutes?: number
  fileFormats?: string[]
  links?: BylineLink[]
}

export type BylineBookRecord = {
  title: string
  subtitle?: string
  tagline?: string
  description?: string
  shortDescription?: string
  cover?: BlobRef
  coverAlt?: string
  status?: string
  genres?: string[]
  tags?: string[]
  links?: BylineLink[]
  editions?: BylineEdition[]
  series?: { name?: string; position?: number }
  authors?: { name: string; did?: string; role?: string }[]
  identifiers?: { hiveId?: string; hiveBookUri?: string; isbn10?: string; isbn13?: string; asin?: string; goodreadsId?: string }
  pageCount?: number
  publisher?: string
  publicationDate?: string
  language?: string
  createdAt: string
}

export type BylineProfileRecord = {
  displayName?: string
  bio?: string
  links?: BylineLink[]
  genres?: string[]
  penNames?: string[]
  avatar?: BlobRef
  createdAt: string
}

export type BylineBook = { uri: string; rkey: string; did: string; pds: string; value: BylineBookRecord }
export type BylineAuthor = { did: string; pds: string; profile: BylineProfileRecord | null; books: BylineBook[] }
export type BylineDirectory = { authors: BylineAuthor[]; loadedAt: number }

const CACHE_KEY = 'byline:directory:v1'
const FRESH_FOR_MS = 6 * 60 * 60 * 1000
let memory: Promise<BylineDirectory> | null = null

async function fetchDirectory(signal?: AbortSignal): Promise<BylineDirectory> {
  const [bookRepos, profileRepos] = await Promise.all([
    listReposWithCollection(BYLINE_BOOK, { signal }),
    listReposWithCollection(BYLINE_PROFILE, { signal }),
  ])
  const dids = [...new Set([...(bookRepos ?? []), ...(profileRepos ?? [])])]
  const limit = createLimiter(6)
  const authors = await Promise.all(
    dids.map((did) =>
      limit(async (): Promise<BylineAuthor | null> => {
        try {
          const pds = await resolvePds(did)
          const [books, profile] = await Promise.all([
            bookRepos?.has(did) ? listAllRecords<BylineBookRecord>(pds, did, BYLINE_BOOK, { maxPages: 5, signal }) : null,
            getRecord<BylineProfileRecord>(pds, did, BYLINE_PROFILE, 'self', signal).catch(() => null),
          ])
          return {
            did,
            pds,
            profile: profile?.value ?? null,
            books: (books?.records ?? [])
              .filter((r) => typeof r.value?.title === 'string')
              .map((r) => ({ uri: r.uri, rkey: rkeyOf(r.uri), did, pds, value: r.value })),
          }
        } catch {
          return null
        }
      }),
    ),
  )
  return { authors: authors.filter((a): a is BylineAuthor => a !== null), loadedAt: Date.now() }
}

/** Every Byline author and their books; cached for six hours (public data). */
export function loadBylineDirectory(cache: KeyValueStore = indexedDbStore()): Promise<BylineDirectory> {
  memory ??= (async () => {
    const stored = await cache.get<BylineDirectory>(CACHE_KEY).catch(() => undefined)
    if (stored && Date.now() - stored.loadedAt < FRESH_FOR_MS) return stored
    const fresh = await fetchDirectory()
    void cache.set(CACHE_KEY, fresh)
    return fresh
  })()
  memory.catch(() => (memory = null))
  return memory
}

/** The author-signed record for a book, matched by hiveId first, then by ISBN. */
export function findBylineBook(
  dir: BylineDirectory,
  book: { hiveId: string; identifiers?: { isbn10?: string; isbn13?: string } },
): { author: BylineAuthor; book: BylineBook } | null {
  const ours = new Set(isbnKeys(book.identifiers))
  let byIsbn: { author: BylineAuthor; book: BylineBook } | null = null
  for (const author of dir.authors) {
    for (const b of author.books) {
      const ids = b.value.identifiers
      if (ids?.hiveId === book.hiveId || ids?.hiveBookUri?.endsWith(`/${book.hiveId}`)) return { author, book: b }
      const theirs = [
        ...isbnKeys(ids),
        ...(b.value.editions ?? []).flatMap((e) => isbnKeys({ isbn10: e.isbn10, isbn13: e.isbn13 })),
      ]
      if (!byIsbn && theirs.some((k) => ours.has(k))) byIsbn = { author, book: b }
    }
  }
  return byIsbn
}

export function normaliseName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** A Byline author by display name, pen name or the credited author name on their books. */
export function findBylineAuthor(dir: BylineDirectory, name: string): BylineAuthor | null {
  const wanted = normaliseName(name)
  if (!wanted) return null
  return (
    dir.authors.find((a) => {
      const names = [
        a.profile?.displayName,
        ...(a.profile?.penNames ?? []),
        ...a.books.flatMap((b) => (b.value.authors ?? []).filter((c) => !c.did || c.did === a.did).map((c) => c.name)),
      ]
      return names.some((n) => typeof n === 'string' && normaliseName(n) === wanted)
    }) ?? null
  )
}

export function bylineCoverUrl(book: BylineBook): string | null {
  const cid = blobCid(book.value.cover)
  return cid ? blobUrl(book.pds, book.did, cid) : null
}

export function bylineAvatarUrl(author: BylineAuthor): string | null {
  const cid = blobCid(author.profile?.avatar)
  return cid ? blobUrl(author.pds, author.did, cid) : null
}

export function bylineAuthorUrl(handle: string): string {
  return `https://byline.pub/authors/${handle}`
}

/** Byline descriptions are Markdown; shown as plain text. */
export function plainText(markdown: string | undefined): string {
  if (!markdown) return ''
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .trim()
}

/** Links worth showing, the author's preferred one first; https only. */
export function bylineLinks(links: BylineLink[] | undefined): BylineLink[] {
  return (links ?? [])
    .filter((l) => typeof l.url === 'string' && l.url.startsWith('https://'))
    .sort((a, b) => Number(!!b.primary) - Number(!!a.primary))
}

export function bylineStatusLabel(status: string | undefined): string | null {
  switch (status) {
    case 'pub.byline.defs#forthcoming':
      return 'Forthcoming'
    case 'pub.byline.defs#outOfPrint':
      return 'Out of print'
    case 'pub.byline.defs#draft':
      return 'Draft'
    default:
      return null
  }
}

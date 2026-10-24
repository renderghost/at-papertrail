import { firstAuthor as firstOf, formatAuthors } from './bookhive/authors'
import { catalogUri, fetchCatalogBook } from './bookhive/catalog'
import { hiveIdCandidates } from './bookhive/hiveId'
import { nextReadingState } from './bookhive/lifecycle'
import { BOOK_COLLECTION, type BookIdentifiers, type BookRecord, type CatalogBook } from './bookhive/types'

/**
 * Book search across Open Library and Google Books (both allow browser
 * requests), with each hit matched to BookHive's catalogue by hiveId.
 */

export type Candidate = {
  key: string
  title: string
  subtitle?: string
  authors: string[]
  isbn13?: string
  isbn10?: string
  year?: number
  pages?: number
  coverUrl?: string
  description?: string
  subjects?: string[]
  publisher?: string
  sources: ('openlibrary' | 'google')[]
}

export type CatalogMatch = {
  hiveId: string
  /** The catalogue entry when BookHive knows this book; null otherwise. */
  catalog: CatalogBook | null
}

const OPEN_LIBRARY = 'https://openlibrary.org'
const GOOGLE_BOOKS = 'https://www.googleapis.com/books/v1/volumes'

/** Lower-case, accent-free, punctuation-free, without a leading article. */
export function normaliseTitle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^(the|a|an) /, '')
    .trim()
}

export function bookKey(title: string, author: string | undefined): string {
  return `${normaliseTitle(title)}|${normaliseTitle(author ?? '')}`
}

export function pickIsbns(isbns: readonly string[] | undefined): { isbn13?: string; isbn10?: string } {
  const clean = (isbns ?? []).map((i) => i.replace(/[^0-9Xx]/g, '').toUpperCase())
  return {
    isbn13: clean.find((i) => i.length === 13 && /^97[89]/.test(i)),
    isbn10: clean.find((i) => i.length === 10),
  }
}

type OpenLibraryDoc = {
  key: string
  title: string
  subtitle?: string
  author_name?: string[]
  first_publish_year?: number
  number_of_pages_median?: number
  isbn?: string[]
  cover_i?: number
  subject?: string[]
  publisher?: string[]
}

export function fromOpenLibrary(doc: OpenLibraryDoc): Candidate {
  return {
    key: `ol:${doc.key}`,
    title: doc.title,
    subtitle: doc.subtitle,
    authors: doc.author_name ?? [],
    ...pickIsbns(doc.isbn),
    year: doc.first_publish_year,
    pages: doc.number_of_pages_median,
    coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : undefined,
    subjects: doc.subject?.slice(0, 8),
    publisher: doc.publisher?.[0],
    sources: ['openlibrary'],
  }
}

type GoogleVolume = {
  id: string
  volumeInfo: {
    title?: string
    subtitle?: string
    authors?: string[]
    publishedDate?: string
    description?: string
    pageCount?: number
    categories?: string[]
    publisher?: string
    imageLinks?: { thumbnail?: string; smallThumbnail?: string }
    industryIdentifiers?: { type: string; identifier: string }[]
  }
}

export function fromGoogle(volume: GoogleVolume): Candidate | null {
  const v = volume.volumeInfo
  if (!v.title) return null
  const ids = v.industryIdentifiers ?? []
  const year = v.publishedDate ? Number.parseInt(v.publishedDate.slice(0, 4), 10) : undefined
  const thumb = v.imageLinks?.thumbnail ?? v.imageLinks?.smallThumbnail
  return {
    key: `gb:${volume.id}`,
    title: v.title,
    subtitle: v.subtitle,
    authors: v.authors ?? [],
    ...pickIsbns(ids.filter((i) => i.type.startsWith('ISBN')).map((i) => i.identifier)),
    year: Number.isFinite(year) ? year : undefined,
    pages: v.pageCount || undefined,
    coverUrl: thumb?.replace(/^http:/, 'https:'),
    description: v.description,
    subjects: v.categories,
    publisher: v.publisher,
    sources: ['google'],
  }
}

/** Fills gaps in `a` from `b`; Open Library wins on identity, Google on prose. */
function merge(a: Candidate, b: Candidate): Candidate {
  return {
    ...a,
    subtitle: a.subtitle ?? b.subtitle,
    authors: a.authors.length ? a.authors : b.authors,
    isbn13: a.isbn13 ?? b.isbn13,
    isbn10: a.isbn10 ?? b.isbn10,
    year: a.year ?? b.year,
    pages: a.pages ?? b.pages,
    coverUrl: a.coverUrl ?? b.coverUrl,
    description: a.description ?? b.description,
    subjects: a.subjects?.length ? a.subjects : b.subjects,
    publisher: a.publisher ?? b.publisher,
    sources: [...new Set([...a.sources, ...b.sources])],
  }
}

/** Interleaves both result lists by rank and folds duplicates together. */
export function mergeCandidates(openLibrary: Candidate[], google: Candidate[]): Candidate[] {
  const merged: Candidate[] = []
  const byIsbn = new Map<string, number>()
  const byTitle = new Map<string, number>()
  const add = (c: Candidate) => {
    const tKey = bookKey(c.title, c.authors[0])
    const index = (c.isbn13 ? byIsbn.get(c.isbn13) : undefined) ?? byTitle.get(tKey)
    if (index !== undefined) {
      merged[index] = merge(merged[index]!, c)
    } else {
      merged.push(c)
    }
    const at = index ?? merged.length - 1
    if (c.isbn13) byIsbn.set(c.isbn13, at)
    byTitle.set(tKey, at)
  }
  for (let i = 0; i < Math.max(openLibrary.length, google.length); i++) {
    if (openLibrary[i]) add(openLibrary[i]!)
    if (google[i]) add(google[i]!)
  }
  return merged.filter((c) => c.authors.length > 0)
}

async function searchOpenLibrary(q: string, signal?: AbortSignal): Promise<Candidate[]> {
  const params = new URLSearchParams({
    q,
    limit: '20',
    fields: 'key,title,subtitle,author_name,first_publish_year,number_of_pages_median,isbn,cover_i,subject,publisher',
  })
  const res = await fetch(`${OPEN_LIBRARY}/search.json?${params}`, { signal })
  if (!res.ok) throw new Error(`Open Library search failed (${res.status})`)
  const body = (await res.json()) as { docs: OpenLibraryDoc[] }
  return body.docs.map(fromOpenLibrary)
}

async function queryGoogle(q: string, maxResults: number, signal?: AbortSignal): Promise<Candidate[]> {
  const params = new URLSearchParams({ q, maxResults: String(maxResults), printType: 'books' })
  const key = import.meta.env.VITE_GOOGLE_BOOKS_API_KEY
  if (key) params.set('key', key)
  const res = await fetch(`${GOOGLE_BOOKS}?${params}`, { signal })
  if (!res.ok) throw new Error(`Google Books search failed (${res.status})`)
  const body = (await res.json()) as { items?: GoogleVolume[] }
  return (body.items ?? []).map(fromGoogle).filter((c): c is Candidate => c !== null)
}

/** Searches both sources; one failing still returns the other's results. */
export async function searchBooks(q: string, signal?: AbortSignal): Promise<Candidate[]> {
  const [ol, gb] = await Promise.allSettled([searchOpenLibrary(q, signal), queryGoogle(q, 20, signal)])
  if (ol.status === 'rejected' && gb.status === 'rejected') {
    throw new Error('Book search is unavailable right now. Try again in a moment.')
  }
  return mergeCandidates(ol.status === 'fulfilled' ? ol.value : [], gb.status === 'fulfilled' ? gb.value : [])
}

export function fullTitle(c: Pick<Candidate, 'title' | 'subtitle'>): string {
  return c.subtitle ? `${c.title}: ${c.subtitle}` : c.title
}

/**
 * Finds this book's hiveId in BookHive's catalogue. When there's no match the
 * id is still computed the way BookHive would, so it lines up if BookHive
 * catalogues the book later.
 */
export async function matchCatalog(c: Candidate): Promise<CatalogMatch> {
  const ids = hiveIdCandidates({ title: c.title, subtitle: c.subtitle, firstAuthor: c.authors[0] ?? '' })
  for (const hiveId of ids) {
    const catalog = await fetchCatalogBook(hiveId)
    if (catalog) return { hiveId, catalog }
  }
  return { hiveId: ids[0]!, catalog: null }
}

/** The minimum needed to add a book to a library. */
export type BookIdentity = {
  hiveId: string
  title: string
  /** Tab-separated. */
  authors: string
  identifiers?: BookIdentifiers
}

export function identityFromCandidate(c: Candidate, hiveId: string): BookIdentity {
  return {
    hiveId,
    title: fullTitle(c),
    authors: formatAuthors(c.authors),
    identifiers: { ...(c.isbn13 ? { isbn13: c.isbn13 } : {}), ...(c.isbn10 ? { isbn10: c.isbn10 } : {}) },
  }
}

/** A new `buzz.bookhive.book` record. Catalogue data wins when BookHive knows the book. */
export function newBookRecord(
  book: BookIdentity,
  catalog: CatalogBook | null,
  status: string,
  now: () => string = () => new Date().toISOString(),
): BookRecord {
  const state = nextReadingState(
    { status: null, startedAt: null, finishedAt: null, previousReads: null },
    { status },
    { now },
  )
  const identifiers: BookIdentifiers = { ...book.identifiers, ...catalog?.identifiers, hiveId: book.hiveId }
  return {
    $type: BOOK_COLLECTION,
    title: catalog?.title ?? book.title,
    authors: catalog?.authors ?? book.authors,
    hiveId: book.hiveId,
    createdAt: now(),
    ...(state.status ? { status: state.status } : {}),
    ...(state.startedAt ? { startedAt: state.startedAt } : {}),
    ...(state.finishedAt ? { finishedAt: state.finishedAt } : {}),
    identifiers,
    ...(catalog ? { hiveBookUri: catalogUri(book.hiveId) } : {}),
  }
}

export type BookDetails = {
  description?: string
  pages?: number
  year?: number
  subjects?: string[]
  publisher?: string
  coverUrl?: string
}

/** Rich details for a book BookHive hasn't catalogued, from Google Books then Open Library. */
export async function lookupBookDetails(
  book: { title: string; authors: string; isbn13?: string },
  signal?: AbortSignal,
): Promise<BookDetails | null> {
  const author = firstOf(book.authors)
  const q = book.isbn13 ? `isbn:${book.isbn13}` : `intitle:${book.title} inauthor:${author}`
  const google = await queryGoogle(q, 3, signal).catch(() => [] as Candidate[])
  let hit = google.find((c) => bookKey(c.title, c.authors[0]) === bookKey(book.title, author)) ?? google[0]
  if (!hit || !hit.description) {
    const ol = await searchOpenLibrary(`${book.title} ${author}`, signal).catch(() => [] as Candidate[])
    const olHit = ol.find((c) => bookKey(fullTitle(c), c.authors[0]) === bookKey(book.title, author)) ?? ol[0]
    hit = hit && olHit ? merge(hit, olHit) : (hit ?? olHit)
  }
  if (!hit) return null
  return {
    description: hit.description,
    pages: hit.pages,
    year: hit.year,
    subjects: hit.subjects,
    publisher: hit.publisher,
    coverUrl: hit.coverUrl,
  }
}

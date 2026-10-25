/**
 * Types for BookHive's lexicons, written from `buzz.bookhive.book`,
 * `buzz.bookhive.defs` and `buzz.bookhive.catalogBook`
 * (https://github.com/nperez0111/bookhive/tree/main/lexicons).
 */

export const BOOK_COLLECTION = 'buzz.bookhive.book'
export const CATALOG_COLLECTION = 'buzz.bookhive.catalogBook'

/** @bookhive.buzz, whose repo publishes the catalogue (rkey = hiveId). */
export const BOOKHIVE_DID = 'did:plc:enu2j5xjlqsjaylv3du4myh4'

export const STATUS = {
  finished: 'buzz.bookhive.defs#finished',
  reading: 'buzz.bookhive.defs#reading',
  wantToRead: 'buzz.bookhive.defs#wantToRead',
  abandoned: 'buzz.bookhive.defs#abandoned',
} as const

export type BookStatus = (typeof STATUS)[keyof typeof STATUS]

export const STATUS_LABEL: Record<BookStatus, string> = {
  [STATUS.reading]: 'Reading',
  [STATUS.wantToRead]: 'Want to read',
  [STATUS.finished]: 'Finished',
  [STATUS.abandoned]: 'Abandoned',
}

export function isBookStatus(value: unknown): value is BookStatus {
  return typeof value === 'string' && value in STATUS_LABEL
}

/** A blob reference as the PDS returns it in JSON, or the legacy form. */
export type BlobRef =
  | { $type: 'blob'; ref: { $link: string }; mimeType: string; size: number }
  | { cid: string; mimeType: string }

export type BookProgress = {
  /** 0–100 */
  percent?: number
  totalPages?: number
  currentPage?: number
  totalChapters?: number
  currentChapter?: number
  updatedAt: string
}

export type PreviousRead = { startedAt?: string; finishedAt: string }

export type BookIdentifiers = {
  hiveId?: string
  isbn10?: string
  isbn13?: string
  goodreadsId?: string
}

/**
 * A `buzz.bookhive.book` record. The index signature keeps fields this app
 * does not know about, so an edit never strips what another client wrote.
 */
export type BookRecord = {
  $type?: typeof BOOK_COLLECTION
  title: string
  /** Tab-separated. */
  authors: string
  hiveId: string
  createdAt: string
  startedAt?: string
  finishedAt?: string
  cover?: BlobRef
  status?: string
  /** 1–10, displayed as 0.5–5 stars. */
  stars?: number
  review?: string
  bookProgress?: BookProgress
  /** Most recent first. */
  previousReads?: PreviousRead[]
  identifiers?: BookIdentifiers
  owned?: boolean
  hiveBookUri?: string
  [key: string]: unknown
}

/** A book record plus where it lives. */
export type BookEntry = {
  uri: string
  cid: string
  rkey: string
  /** Owner's DID. */
  did: string
  /** Owner's PDS origin, for blob URLs. */
  pds: string
  value: BookRecord
}

/** A `buzz.bookhive.catalogBook` record from @bookhive.buzz. */
export type CatalogBook = {
  id: string
  title: string
  /** Tab-separated. */
  authors: string
  thumbnail: string
  thumbnailBlob?: BlobRef
  cover?: string
  coverBlob?: BlobRef
  description?: string
  source?: string
  sourceUrl?: string
  /** 0–5000, where 1000 is one star. */
  rating?: number
  ratingsCount?: number
  genres?: string[]
  series?: string
  identifiers?: BookIdentifiers
  language?: string
  numPages?: number
  publicationYear?: number
  publisher?: string
  authorBio?: string
}

export function blobCid(blob: BlobRef | undefined): string | null {
  if (!blob) return null
  if ('ref' in blob && blob.ref?.$link) return blob.ref.$link
  if ('cid' in blob && blob.cid) return blob.cid
  return null
}

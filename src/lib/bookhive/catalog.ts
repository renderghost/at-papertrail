import { blobUrl, getRecord } from '../atproto'
import { resolvePds } from '../identity'
import { createLimiter } from '../pool'
import { BOOKHIVE_DID, CATALOG_COLLECTION, blobCid, type CatalogBook } from './types'

/**
 * BookHive's catalogue is published as `buzz.bookhive.catalogBook` records on
 * @bookhive.buzz's own PDS, keyed by hiveId — public AT data a browser can read
 * directly, unlike bookhive.buzz's XRPC API, which sends no CORS headers.
 */

const limit = createLimiter(6)

export function catalogPds(): Promise<string> {
  return resolvePds(BOOKHIVE_DID)
}

export async function fetchCatalogBook(hiveId: string): Promise<CatalogBook | null> {
  const pds = await catalogPds()
  const record = await limit(() => getRecord<CatalogBook>(pds, BOOKHIVE_DID, CATALOG_COLLECTION, hiveId))
  return record?.value ?? null
}

export function catalogUri(hiveId: string): string {
  return `at://${BOOKHIVE_DID}/${CATALOG_COLLECTION}/${hiveId}`
}

function absoluteImageUrl(url: string | undefined): string | null {
  if (!url) return null
  if (url.startsWith('https://')) return url
  if (url.startsWith('/')) return `https://bookhive.buzz${url}`
  return null
}

/** Cover candidates for a catalogue book, best first. */
export function catalogCoverUrls(book: CatalogBook, pds: string): string[] {
  const urls: string[] = []
  const cid = blobCid(book.coverBlob) ?? blobCid(book.thumbnailBlob)
  if (cid) urls.push(blobUrl(pds, BOOKHIVE_DID, cid))
  for (const url of [book.cover, book.thumbnail]) {
    const absolute = absoluteImageUrl(url)
    if (absolute) urls.push(absolute)
  }
  return urls
}

export function bookhiveBookUrl(hiveId: string): string {
  return `https://bookhive.buzz/books/${hiveId}`
}

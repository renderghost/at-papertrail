import { blobUrl, getRecord } from '../atproto'
import { indexedDbStore, type KeyValueStore } from '../cache'
import { resolvePds } from '../identity'
import { createLimiter } from '../pool'
import { BOOKHIVE_DID, CATALOG_COLLECTION, blobCid, type CatalogBook } from './types'

/**
 * BookHive's catalogue is published as `buzz.bookhive.catalogBook` records on
 * @bookhive.buzz's own PDS, keyed by hiveId — public AT data a browser can read
 * directly, unlike bookhive.buzz's XRPC API, which sends no CORS headers.
 */

const limit = createLimiter(6)
/** Series lookups queue apart, so a page's covers never wait behind them. */
const background = createLimiter(4)

export function catalogPds(): Promise<string> {
  return resolvePds(BOOKHIVE_DID)
}

const DAY = 24 * 60 * 60 * 1000
/** BookHive may catalogue a missing book any day; a catalogued book's series never changes. */
const MISS_TTL = 3 * DAY
const SERIES_TTL = 30 * DAY

/**
 * What a lookup found, remembered between visits (just this, not the record):
 * a missing book isn't asked for again for a few days, which also spares the
 * console the PDS's 400 for each one, and a series is known for weeks.
 */
type Remembered = { at: number; catalogued: boolean; series?: string }

let memoStore: KeyValueStore | null = null
const memo = () => (memoStore ??= indexedDbStore())
const memoKey = (hiveId: string) => `catalog-meta:${hiveId}`

async function remembered(hiveId: string, cache: KeyValueStore): Promise<Remembered | undefined> {
  const known = await cache.get<Remembered>(memoKey(hiveId)).catch(() => undefined)
  return known && Date.now() - known.at < (known.catalogued ? SERIES_TTL : MISS_TTL) ? known : undefined
}

type Lookup = { promise: Promise<CatalogBook | null>; urgent: boolean }
const inFlight = new Map<string, Lookup>()

export type CatalogOptions = {
  /** Ask the PDS even if the book was missing a moment ago (the match fixer). */
  fresh?: boolean
  /** Queue behind everything else on the page. */
  background?: boolean
  cache?: KeyValueStore
}

export async function fetchCatalogBook(hiveId: string, { fresh = false, background: low = false, cache = memo() }: CatalogOptions = {}): Promise<CatalogBook | null> {
  if (!fresh && (await remembered(hiveId, cache))?.catalogued === false) return null
  // One request per book at a time, but a cover never waits on a queued background read.
  const current = inFlight.get(hiveId)
  if (current && (current.urgent || low)) return current.promise
  const promise = (low ? background : limit)(async () => {
    const urgent = inFlight.get(hiveId)
    if (low && urgent?.urgent) return urgent.promise
    const pds = await catalogPds()
    const book = (await getRecord<CatalogBook>(pds, BOOKHIVE_DID, CATALOG_COLLECTION, hiveId))?.value ?? null
    const note: Remembered = { at: Date.now(), catalogued: !!book, ...(book?.series ? { series: book.series } : {}) }
    void cache.set(memoKey(hiveId), note).catch(() => undefined)
    return book
  })
  inFlight.set(hiveId, { promise, urgent: !low })
  void promise
    .catch(() => null)
    .then(() => {
      if (inFlight.get(hiveId)?.promise === promise) inFlight.delete(hiveId)
    })
  return promise
}

/** A book's series as the catalogue writes it (BookHive's JSON string), or null; read in the background. */
export async function catalogSeries(hiveId: string, cache: KeyValueStore = memo()): Promise<string | null> {
  const known = await remembered(hiveId, cache)
  if (known) return known.series ?? null
  return (await fetchCatalogBook(hiveId, { fresh: true, background: true, cache }))?.series ?? null
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

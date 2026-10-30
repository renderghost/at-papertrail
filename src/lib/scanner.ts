import { hiveIdForIsbn, getHiveBook, type HiveBook } from './bookhive/api'
import { fetchCatalogBook } from './bookhive/catalog'
import type { CatalogBook } from './bookhive/types'
import { isBooklandEan } from './isbn'
import { matchCatalog, searchBooks, type Candidate } from './search'

/**
 * Barcode scanning (#59). The browser's own BarcodeDetector where it has one
 * (Chrome and Android); everywhere else (every iOS browser, Firefox) zxing-wasm,
 * loaded on demand from this site. Its WebAssembly needs 'wasm-unsafe-eval' in
 * the Content-Security-Policy; JavaScript eval stays blocked.
 */

export type Detector = {
  kind: 'native' | 'zxing'
  /** The barcodes in the current frame (raw values). */
  detect: (video: HTMLVideoElement) => Promise<string[]>
}

type NativeDetector = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> }
type NativeDetectorClass = {
  new (options: { formats: string[] }): NativeDetector
  getSupportedFormats(): Promise<string[]>
}

async function nativeDetector(): Promise<Detector | null> {
  const Native = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector
  if (!Native) return null
  try {
    if (!(await Native.getSupportedFormats()).includes('ean_13')) return null
    const detector = new Native({ formats: ['ean_13'] })
    return { kind: 'native', detect: async (video) => (await detector.detect(video)).map((r) => r.rawValue) }
  } catch {
    return null
  }
}

async function zxingDetector(): Promise<Detector> {
  const [{ prepareZXingModule, readBarcodes }, { default: wasmUrl }] = await Promise.all([
    import('zxing-wasm/reader'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ])
  // Served from this site, never a CDN.
  await prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
    fireImmediately: true,
  })
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error("This browser can't read camera frames.")
  return {
    kind: 'zxing',
    detect: async (video) => {
      if (!video.videoWidth || !video.videoHeight) return []
      // Big frames don't read better, only slower.
      const scale = Math.min(1, 1280 / video.videoWidth)
      canvas.width = Math.round(video.videoWidth * scale)
      canvas.height = Math.round(video.videoHeight * scale)
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      const results = await readBarcodes(context.getImageData(0, 0, canvas.width, canvas.height), {
        formats: ['EAN13'],
        tryHarder: true,
        maxNumberOfSymbols: 1,
      })
      return results.filter((r) => r.isValid).map((r) => r.text)
    },
  }
}

export async function createDetector(): Promise<Detector> {
  return (await nativeDetector()) ?? zxingDetector()
}

/** The book ISBNs among the codes in a frame. */
export function bookCodes(codes: string[]): string[] {
  return [...new Set(codes.map((c) => c.trim()).filter(isBooklandEan))]
}

/**
 * A scanned book, ready to add: catalogued when BookHive knows it, else found
 * on Open Library or Google Books with the hiveId BookHive would give it.
 */
export type ScannedBook = {
  isbn: string
  hiveId: string
  title: string
  /** Tab-separated, as in `buzz.bookhive.book`. */
  authors: string
  identifiers: { isbn13: string; isbn10?: string }
  catalog: CatalogBook | null
  coverUrl?: string
}

export type IsbnDeps = {
  hiveIdForIsbn: (isbn: string, signal?: AbortSignal) => Promise<string | null>
  catalogue: (hiveId: string, signal?: AbortSignal) => Promise<CatalogBook | null>
  search: (q: string, signal?: AbortSignal) => Promise<Candidate[]>
  match: (c: Candidate) => Promise<{ hiveId: string; catalog: CatalogBook | null }>
}

export const isbnDeps: IsbnDeps = {
  hiveIdForIsbn,
  catalogue: async (hiveId, signal) => (await fetchCatalogBook(hiveId)) ?? ((await getHiveBook(hiveId, signal))?.book ?? null),
  search: (q, signal) => searchBooks(q, signal),
  match: matchCatalog,
}

/** The book behind an ISBN: BookHive's catalogue first, then Open Library and Google Books. Null if nobody knows it. */
export async function lookupIsbn(isbn: string, deps: IsbnDeps = isbnDeps, signal?: AbortSignal): Promise<ScannedBook | null> {
  const hiveId = await deps.hiveIdForIsbn(isbn, signal).catch(() => null)
  const book = hiveId ? await deps.catalogue(hiveId, signal).catch(() => null) : null
  if (book) return fromCatalogue(isbn, book)
  const candidates = await deps.search(`isbn:${isbn}`, signal).catch(() => [] as Candidate[])
  const candidate = candidates.find((c) => c.isbn13 === isbn) ?? candidates[0]
  if (!candidate) return null
  const match = await deps.match(candidate)
  if (match.catalog) return fromCatalogue(isbn, match.catalog)
  return {
    isbn,
    hiveId: match.hiveId,
    title: candidate.subtitle ? `${candidate.title}: ${candidate.subtitle}` : candidate.title,
    authors: candidate.authors.join('\t'),
    identifiers: { isbn13: isbn, ...(candidate.isbn10 ? { isbn10: candidate.isbn10 } : {}) },
    catalog: null,
    ...(candidate.coverUrl ? { coverUrl: candidate.coverUrl } : {}),
  }
}

function fromCatalogue(isbn: string, book: HiveBook): ScannedBook {
  return {
    isbn,
    hiveId: book.id,
    title: book.title,
    authors: book.authors,
    // The edition you're holding, plus the catalogue's ISBN-10 if it has one.
    identifiers: { isbn13: isbn, ...(book.identifiers?.isbn10 ? { isbn10: book.identifiers.isbn10 } : {}) },
    catalog: book,
    ...(book.cover || book.thumbnail ? { coverUrl: book.cover || book.thumbnail } : {}),
  }
}

import { describe, expect, it, vi } from 'vitest'
import { getHiveId } from '../bookhive/hiveId'
import { STATUS, type BookEntry, type BookRecord, type CatalogBook } from '../bookhive/types'
import { computedHiveIds, libraryIndex, matchRow, type MatchDeps } from './match'
import { buildPlan, fillGaps, importRecord, summarise } from './plan'
import type { ImportRow } from './sources'

const NOW = () => '2026-10-29T00:00:00.000Z'

function row(extra: Partial<ImportRow> = {}): ImportRow {
  return {
    line: 2,
    title: 'Onyx Storm (The Empyrean, #3)',
    bareTitle: 'Onyx Storm',
    authors: ['Rebecca Yarros'],
    status: STATUS.finished,
    previousReads: [],
    ratingRounded: false,
    owned: false,
    shelves: [],
    extras: { moods: false, pace: false, contentWarnings: false, spoiler: false, undatedRereads: 0 },
    ...extra,
  }
}

const ONYX_ID = getHiveId({ title: 'Onyx Storm', authors: 'Rebecca Yarros' })
const catalogue = (extra: Partial<CatalogBook> = {}): CatalogBook => ({
  id: ONYX_ID,
  title: 'Onyx Storm',
  authors: 'Rebecca Yarros',
  thumbnail: '',
  identifiers: { hiveId: ONYX_ID, isbn13: '9781649374189' },
  ...extra,
})

function entry(value: Partial<BookRecord>, rkey = 'r1'): BookEntry {
  return {
    uri: `at://did:plc:me/buzz.bookhive.book/${rkey}`,
    cid: `cid-${rkey}`,
    rkey,
    did: 'did:plc:me',
    pds: 'https://pds.test',
    value: { title: 'Onyx Storm', authors: 'Rebecca Yarros', hiveId: ONYX_ID, createdAt: '2025-01-01T00:00:00.000Z', ...value },
  }
}

describe('fillGaps', () => {
  it('never overwrites what the record already has', () => {
    const base = entry({ status: STATUS.finished, finishedAt: '2025-06-01T00:00:00.000Z', stars: 6, review: 'Mine', owned: true }).value
    const { next, changes } = fillGaps(base, row({ status: STATUS.wantToRead, stars: 10, review: 'Theirs', owned: true }))
    expect(next).toMatchObject({ status: STATUS.finished, finishedAt: '2025-06-01T00:00:00.000Z', stars: 6, review: 'Mine', owned: true })
    expect(changes).toEqual([])
  })

  it('fills missing status, dates, rating, review, owned and ISBNs', () => {
    const { next, changes } = fillGaps(
      entry({}).value,
      row({ startedAt: '2025-02-01T00:00:00.000Z', finishedAt: '2025-02-15T00:00:00.000Z', stars: 9, review: 'Great', owned: true, isbn13: '9781649374189', goodreadsId: '209439446' }),
    )
    expect(next).toMatchObject({
      status: STATUS.finished,
      startedAt: '2025-02-01T00:00:00.000Z',
      finishedAt: '2025-02-15T00:00:00.000Z',
      stars: 9,
      review: 'Great',
      owned: true,
      identifiers: { isbn13: '9781649374189', goodreadsId: '209439446' },
    })
    expect(changes).toEqual(['status', 'started', 'finished', 'rating', 'review', 'owned', 'identifiers'])
  })

  it('files a different finished read as an earlier read, once', () => {
    const base = entry({ status: STATUS.reading, startedAt: '2026-10-01T00:00:00.000Z' }).value
    const imported = row({
      finishedAt: '2025-02-15T00:00:00.000Z',
      previousReads: [{ finishedAt: '2021-03-20T00:00:00.000Z' }],
    })
    const { next, changes } = fillGaps(base, imported)
    expect(next.status).toBe(STATUS.reading)
    expect(next.finishedAt).toBeUndefined()
    expect(next.previousReads).toEqual([{ finishedAt: '2025-02-15T00:00:00.000Z' }, { finishedAt: '2021-03-20T00:00:00.000Z' }])
    expect(changes).toEqual(['reads'])
    // Importing the same file again adds nothing.
    expect(fillGaps(next, imported).changes).toEqual([])
  })

  it("doesn't duplicate the current read as an earlier one", () => {
    const base = entry({ status: STATUS.finished, finishedAt: '2025-02-15T09:30:00.000Z' }).value
    expect(fillGaps(base, row({ finishedAt: '2025-02-15T00:00:00.000Z' })).changes).toEqual([])
  })
})

describe('importRecord', () => {
  it('uses the catalogue entry when BookHive knows the book', () => {
    const record = importRecord(row({ createdAt: '2024-07-31T00:00:00.000Z', isbn10: '1649374186', isbn13: '9781649374196' }), catalogue(), NOW)
    expect(record).toMatchObject({
      $type: 'buzz.bookhive.book',
      title: 'Onyx Storm',
      hiveId: ONYX_ID,
      createdAt: '2024-07-31T00:00:00.000Z',
      status: STATUS.finished,
      // Your edition's ISBN wins over the catalogue's.
      identifiers: { hiveId: ONYX_ID, isbn13: '9781649374196', isbn10: '1649374186' },
      hiveBookUri: `at://did:plc:enu2j5xjlqsjaylv3du4myh4/buzz.bookhive.catalogBook/${ONYX_ID}`,
    })
  })

  it("keeps titles within BookHive's 512-byte limit", () => {
    const record = importRecord(row({ title: 'é'.repeat(400), bareTitle: 'é'.repeat(400) }), null, NOW)
    expect(new TextEncoder().encode(record.title).length).toBe(512)
  })

  it("computes BookHive's id for a book it doesn't know yet, and never stamps today's date on a read", () => {
    const record = importRecord(row({ authors: ['Rebecca Yarros', 'Someone Else'] }), null, NOW)
    expect(record.hiveId).toBe(ONYX_ID)
    expect(record.authors).toBe('Rebecca Yarros\tSomeone Else')
    expect(record.hiveBookUri).toBeUndefined()
    expect(record.finishedAt).toBeUndefined()
    expect(record.createdAt).toBe(NOW())
  })
})

describe('matchRow', () => {
  const deps = (over: Partial<MatchDeps> = {}): MatchDeps => ({
    catalogue: vi.fn(async () => null),
    hiveIdForIsbn: vi.fn(async () => null),
    search: vi.fn(async () => []),
    ...over,
  })

  it('finds a book already in the library without a request', async () => {
    const d = deps()
    const mine = entry({ identifiers: { isbn10: '1649374186' } })
    const match = await matchRow(row({ title: 'Something else', bareTitle: 'Something else', isbn13: '9781649374189' }), libraryIndex([mine]), d)
    expect(match).toEqual({ kind: 'library', entry: mine })
    expect(d.hiveIdForIsbn).not.toHaveBeenCalled()
    expect(d.search).not.toHaveBeenCalled()
  })

  it('finds a re-imported Goodreads row by its Goodreads id, whatever the title', async () => {
    const picked = entry({ title: 'The Farthest Shore (Ged, #3)', hiveId: 'bk_picked', identifiers: { goodreadsId: '13663' } })
    const match = await matchRow(row({ title: 'The Farthest Shore', bareTitle: 'The Farthest Shore', goodreadsId: '13663' }), libraryIndex([picked]), deps())
    expect(match).toEqual({ kind: 'library', entry: picked })
  })

  it('tries ISBN, then the computed hiveId, then search', async () => {
    const byIsbn = deps({ hiveIdForIsbn: vi.fn(async () => ONYX_ID), catalogue: vi.fn(async () => catalogue()) })
    expect(await matchRow(row({ isbn13: '9781649374189' }), new Map(), byIsbn)).toMatchObject({ kind: 'catalogue', via: 'isbn' })

    const byTitle = deps({ catalogue: vi.fn(async (id: string) => (id === ONYX_ID ? catalogue() : null)) })
    expect(await matchRow(row(), new Map(), byTitle)).toMatchObject({ kind: 'catalogue', via: 'title' })
    expect(computedHiveIds(row())[0]).toBe(ONYX_ID)

    const bySearch = deps({ search: vi.fn(async () => [catalogue({ id: 'bk_other', title: 'Onyx Storm' })]) })
    expect(await matchRow(row(), new Map(), bySearch)).toMatchObject({ kind: 'catalogue', via: 'search', book: { id: 'bk_other' } })
    expect(bySearch.search).toHaveBeenCalledWith('Onyx Storm Rebecca Yarros', undefined)
  })

  it('returns search results as suggestions when nothing matches, and survives failures', async () => {
    const near = catalogue({ id: 'bk_near', title: 'Iron Flame', identifiers: { isbn13: '9781649374042' } })
    const d = deps({ hiveIdForIsbn: vi.fn(async () => Promise.reject(new Error('down'))), search: vi.fn(async () => [near]) })
    expect(await matchRow(row({ isbn13: '9781649374189' }), new Map(), d)).toEqual({ kind: 'unmatched', suggestions: [near] })
  })
})

describe('buildPlan', () => {
  it('creates, updates, leaves alone and holds back unmatched rows', () => {
    const rows = [
      row({ line: 2 }),
      row({ line: 3, title: 'Dune', bareTitle: 'Dune', authors: ['Frank Herbert'], stars: 10 }),
      row({ line: 4, title: 'Kept', bareTitle: 'Kept', authors: ['A'] }),
      row({ line: 5, title: 'Mystery', bareTitle: 'Mystery', authors: ['B'] }),
    ]
    const dune = entry({ title: 'Dune', authors: 'Frank Herbert', hiveId: 'bk_dune' }, 'd')
    const kept = entry({ title: 'Kept', authors: 'A', hiveId: 'bk_kept', status: STATUS.finished }, 'k')
    const matches = new Map([
      [2, { kind: 'catalogue' as const, book: catalogue(), via: 'title' as const }],
      [3, { kind: 'library' as const, entry: dune }],
      [4, { kind: 'library' as const, entry: kept }],
      [5, { kind: 'unmatched' as const, suggestions: [] }],
    ])
    const plan = buildPlan(rows, matches, new Map(), NOW)
    expect(plan.map((p) => p.kind)).toEqual(['create', 'update', 'same', 'unmatched'])
    expect(summarise(plan, rows)).toMatchObject({ create: 1, uncatalogued: 0, update: 1, same: 1, unmatched: 1 })

    // Resolving the unmatched row: save it uncatalogued, or skip it.
    expect(buildPlan(rows, matches, new Map([[5, { book: null }]]), NOW).at(-1)).toMatchObject({ kind: 'create', catalogued: false })
    expect(buildPlan(rows, matches, new Map([[5, 'skip' as const]]), NOW)).toHaveLength(3)
  })

  it('merges two rows for the same book into one write', () => {
    const rows = [row({ line: 2, stars: 8 }), row({ line: 3, review: 'Second row', owned: true })]
    const m = { kind: 'catalogue' as const, book: catalogue(), via: 'title' as const }
    const plan = buildPlan(rows, new Map([[2, m], [3, m]]), new Map(), NOW)
    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({ kind: 'create', record: { stars: 8, review: 'Second row', owned: true } })
  })
})

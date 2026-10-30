import { describe, expect, it, vi } from 'vitest'
import type { HiveBook } from './bookhive/api'
import { STATUS, type BookEntry, type BookRecord } from './bookhive/types'
import { booksInSeries, findInSeries, seriesOf, seriesProgress, withSeries } from './series'

const book = (id: string, title: string, position?: string, extra: Partial<HiveBook> = {}): HiveBook => ({
  id,
  title,
  authors: 'Ursula K. Le Guin',
  thumbnail: '',
  ...(position !== undefined ? { series: JSON.stringify({ title: 'Earthsea Cycle', position }) } : {}),
  ...extra,
})

const catalogue = [
  book('bk_3', 'The Farthest Shore', '3'),
  book('bk_1', 'A Wizard of Earthsea', '1', { ratingsCount: 900 }),
  book('bk_1b', 'A Wizard of Earthsea (50th anniversary)', '1', { ratingsCount: 10 }),
  book('bk_2', 'The Tombs of Atuan', '2'),
  book('bk_15', 'The Word of Unbinding', '1.5'),
  book('bk_4', 'Tehanu', '4'),
  book('bk_x', 'The Left Hand of Darkness', undefined),
  book('bk_other', 'Rocannon', '1', { series: JSON.stringify({ title: 'Hainish Cycle', position: '1' }) }),
]

function entry(hiveId: string, value: Partial<BookRecord>): BookEntry {
  return {
    uri: `at://did:plc:me/buzz.bookhive.book/${hiveId}`,
    cid: 'c',
    rkey: hiveId,
    did: 'did:plc:me',
    pds: 'https://pds.test',
    value: { title: 't', authors: 'Ursula K. Le Guin', hiveId, createdAt: '', ...value },
  }
}

describe('booksInSeries', () => {
  it('keeps one edition of each, in reading order, novellas in place', () => {
    expect(booksInSeries(catalogue, 'earthsea cycle').map((b) => b.id)).toEqual(['bk_1', 'bk_15', 'bk_2', 'bk_3', 'bk_4'])
  })
})

describe('seriesProgress', () => {
  it('starts at the first book when you have read none', () => {
    const p = seriesProgress(catalogue, 'Earthsea Cycle')
    expect(p).toMatchObject({ read: 0, total: 4, gaps: [] })
    expect(p.next?.book.id).toBe('bk_1')
  })

  it('finds the next book after the furthest one read, and the gaps before it', () => {
    const library = [
      entry('bk_1', { status: STATUS.finished }),
      entry('bk_3', { status: STATUS.reading, previousReads: [{ finishedAt: '2020-01-01T00:00:00.000Z' }] }),
    ]
    const p = seriesProgress(catalogue, 'Earthsea Cycle', library)
    expect(p.read).toBe(2)
    expect(p.next?.book.id).toBe('bk_4')
    expect(p.gaps.map((g) => g.book.id)).toEqual(['bk_2'])
    expect(p.books.find((b) => b.book.id === 'bk_1')?.entry?.rkey).toBe('bk_1')
    // The novella is listed but never "next" or a gap.
    expect(p.books.find((b) => b.book.id === 'bk_15')?.main).toBe(false)
  })

  it('matches your copy by title when its hiveId differs, and has no next once done', () => {
    const library = ['A Wizard of Earthsea', 'The Tombs of Atuan', 'The Farthest Shore', 'Tehanu'].map((t, i) =>
      entry(`bk_mine${i}`, { title: t, status: STATUS.finished }),
    )
    const p = seriesProgress(catalogue, 'Earthsea Cycle', library)
    expect(p.read).toBe(4)
    expect(p.next).toBeUndefined()
  })
})

describe('editions and box sets', () => {
  const earthsea = (position: string) => JSON.stringify({ title: 'Earthsea Cycle', position })
  const shelf = [
    book('bk_en1', 'A Wizard of Earthsea', '1', { language: 'English', ratingsCount: 379765 }),
    book('bk_fr1', 'Le sorcier de Terremer', '1', { language: 'French', ratingsCount: 379268 }),
    book('bk_es2', 'Las tumbas de Atuan', '2', { language: 'Spanish; Castilian', ratingsCount: 142800 }),
    book('bk_en2', 'The Tombs of Atuan', '2', { language: 'English', ratingsCount: 142704 }),
    book('bk_box', 'The Earthsea Quartet', undefined, { series: earthsea('1-4'), language: 'English', ratingsCount: 13484 }),
  ]

  it("lists one edition per book, in the reader's language, with box sets as extras", () => {
    const p = seriesProgress(shelf, 'Earthsea Cycle', [], 'English')
    expect(p.books.map((b) => [b.book.id, b.main])).toEqual([
      ['bk_en1', true],
      ['bk_en2', true],
      ['bk_box', false],
    ])
    expect(p.total).toBe(2)
    expect(booksInSeries(shelf, 'Earthsea Cycle', 'French')[0]!.id).toBe('bk_fr1')
  })

  it('shows your own edition, whatever its language, and counts it as read', () => {
    const p = seriesProgress(shelf, 'Earthsea Cycle', [entry('bk_fr1', { title: 'Le sorcier de Terremer', status: STATUS.finished })], 'English')
    expect(p.books[0]).toMatchObject({ book: { id: 'bk_fr1' }, entry: { rkey: 'bk_fr1' } })
    expect(p.read).toBe(1)
    expect(p.next?.book.id).toBe('bk_en2')
  })

  it('reads an unnumbered series in the order listed, but never a box set as next', () => {
    const plain = [book('bk_a', 'Alpha', undefined, { series: JSON.stringify({ title: 'Earthsea Cycle' }) })]
    expect(seriesProgress(plain, 'Earthsea Cycle').next?.book.id).toBe('bk_a')
    const done = seriesProgress(shelf, 'Earthsea Cycle', [entry('bk_en1', { status: STATUS.finished }), entry('bk_en2', { status: STATUS.finished })])
    expect(done.next).toBeUndefined()
  })
})

describe('withSeries', () => {
  it("fills in series from catalogue records, keeping any the listing had, and survives failures", async () => {
    const listing = [book('bk_a', 'Alpha'), book('bk_b', 'Beta', '2'), book('bk_c', 'Gamma')]
    const lookup = vi.fn(async (id: string) => {
      if (id === 'bk_c') throw new Error('down')
      return JSON.stringify({ title: 'Earthsea Cycle', position: '1' })
    })
    const filled = await withSeries(listing, lookup)
    expect(filled.map((b) => b.series && JSON.parse(b.series).position)).toEqual(['1', '2', undefined])
    expect(lookup).not.toHaveBeenCalledWith('bk_b')
  })
})

describe('findInSeries', () => {
  it('stops reading catalogue records once the book and its editions have turned up', async () => {
    const pos = (title: string, position: string) => JSON.stringify({ title, position })
    const listing = Array.from({ length: 30 }, (_, i) => book(`bk_${i}`, `Book ${i}`, undefined, { ratingsCount: 100000 - i * 1000 }))
    // The sequel is the 3rd most popular; its translation sits right beside it.
    const series: Record<string, string> = { bk_2: pos('Earthsea Cycle', '2'), bk_3: pos('Earthsea Cycle', '2'), bk_29: pos('Earthsea Cycle', '3') }
    listing[3]!.ratingsCount = listing[2]!.ratingsCount! - 50
    const lookup = vi.fn(async (id: string) => series[id] ?? null)
    const found = await findInSeries(listing, 'earthsea cycle', 2, lookup)
    expect(found.map((b) => b.id)).toEqual(['bk_2', 'bk_3'])
    // Two batches of six at most, not all thirty books.
    expect(lookup.mock.calls.length).toBeLessThanOrEqual(12)
    expect(await findInSeries(listing, 'Earthsea Cycle', 9, lookup)).toEqual([])
  })
})

describe('seriesOf', () => {
  it('names the series and its author', () => {
    expect(seriesOf(catalogue[0])).toEqual({ title: 'Earthsea Cycle', author: 'Ursula K. Le Guin', position: '3' })
    expect(seriesOf(catalogue[6])).toBeNull()
  })
})

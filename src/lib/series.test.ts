import { describe, expect, it } from 'vitest'
import type { HiveBook } from './bookhive/api'
import { STATUS, type BookEntry, type BookRecord } from './bookhive/types'
import { booksInSeries, seriesOf, seriesProgress } from './series'

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

describe('seriesOf', () => {
  it('names the series and its author', () => {
    expect(seriesOf(catalogue[0])).toEqual({ title: 'Earthsea Cycle', author: 'Ursula K. Le Guin', position: '3' })
    expect(seriesOf(catalogue[6])).toBeNull()
  })
})

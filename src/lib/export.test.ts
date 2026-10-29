import { describe, expect, it } from 'vitest'
import { STATUS, type BookRecord } from './bookhive/types'
import { goodreadsCsv, lastFirst, shelfName } from './export'
import { parseExport } from './import/sources'
import type { BookList } from './lists'

const books: BookRecord[] = [
  {
    title: 'The Left Hand of Darkness',
    authors: 'Ursula K. Le Guin',
    hiveId: 'bk_left',
    createdAt: '2025-01-10T12:00:00.000Z',
    status: STATUS.finished,
    finishedAt: '2025-02-15T00:00:00.000Z',
    previousReads: [{ finishedAt: '2019-05-01T00:00:00.000Z' }],
    stars: 9,
    review: 'Ice, "kemmer" and loyalty,\nall at once.',
    owned: true,
    identifiers: { hiveId: 'bk_left', isbn13: '9780441478125', isbn10: '0441478123', goodreadsId: '18423' },
  },
  { title: 'Infinite Jest', authors: 'David Foster Wallace\tSomeone Else', hiveId: 'bk_jest', createdAt: '2024-06-01T00:00:00.000Z', status: STATUS.abandoned },
  { title: 'Unsorted', authors: 'Anon', hiveId: 'bk_x', createdAt: '2024-01-01T00:00:00.000Z' },
]

const lists = [
  { value: { name: 'Books to press on friends' }, items: [{ value: { identifiers: { hiveId: 'bk_left' } } }] },
] as unknown as BookList[]

describe('goodreadsCsv', () => {
  it("writes Goodreads' layout, and reads back through the importer", () => {
    const csv = goodreadsCsv(books, lists)
    expect(csv.split('\r\n')[0]).toBe(
      'Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies',
    )
    expect(csv).toContain('"=""0441478123""","=""9780441478125""",4,')
    const { source, rows } = parseExport(csv)
    expect(source).toBe('goodreads')
    expect(rows[0]).toMatchObject({
      title: 'The Left Hand of Darkness',
      authors: ['Ursula K. Le Guin'],
      goodreadsId: '18423',
      isbn13: '9780441478125',
      status: STATUS.finished,
      finishedAt: '2025-02-15T00:00:00.000Z',
      createdAt: '2025-01-10T00:00:00.000Z',
      // Half stars round down for Goodreads.
      stars: 8,
      review: 'Ice, "kemmer" and loyalty,\nall at once.',
      owned: true,
      shelves: ['books-to-press-on-friends'],
      extras: { undatedRereads: 1 },
    })
    expect(rows[1]).toMatchObject({ status: STATUS.abandoned, authors: ['David Foster Wallace', 'Someone Else'], shelves: [] })
    expect(rows[2]).toMatchObject({ status: STATUS.wantToRead })
  })
})

describe('helpers', () => {
  it('writes names surname first, keeping particles', () => {
    expect(lastFirst('Ursula K. Le Guin')).toBe('Le Guin, Ursula K.')
    expect(lastFirst('Ludwig van Beethoven')).toBe('van Beethoven, Ludwig')
    expect(lastFirst('Homer')).toBe('Homer')
  })

  it('makes Goodreads-style shelf names', () => {
    expect(shelfName(' Books to press on friends! ')).toBe('books-to-press-on-friends')
    expect(shelfName('Café reads')).toBe('café-reads')
  })
})

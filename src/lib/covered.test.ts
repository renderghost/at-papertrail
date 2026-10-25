import { describe, expect, it } from 'vitest'
import { entry, profile } from '../test/fixtures'
import { STATUS } from './bookhive/types'
import { availablePeriods, computeCovered, daysToRead, parsePeriodSlug, periodSlug, readsIn } from './covered'

const me = profile('me.test')

const books = [
  entry(me, {
    title: 'Piranesi',
    authors: 'Susanna Clarke',
    status: STATUS.finished,
    startedAt: '2025-01-03T00:00:00.000Z',
    finishedAt: '2025-01-09T00:00:00.000Z',
    stars: 10,
    review: 'A house of wonders.',
  }),
  entry(me, {
    title: 'Jonathan Strange & Mr Norrell',
    authors: 'Susanna Clarke',
    status: STATUS.finished,
    startedAt: '2025-02-01T00:00:00.000Z',
    finishedAt: '2025-03-15T00:00:00.000Z',
    stars: 8,
  }),
  entry(me, {
    title: 'Dune',
    authors: 'Frank Herbert',
    status: STATUS.reading,
    startedAt: '2025-06-01T00:00:00.000Z',
    // Read twice before: once in 2025, once in 2019.
    previousReads: [
      { startedAt: '2025-04-01T00:00:00.000Z', finishedAt: '2025-04-01T00:00:00.000Z' },
      { finishedAt: '2019-08-01T00:00:00.000Z' },
    ],
  }),
  entry(me, {
    title: 'Ulysses',
    authors: 'James Joyce',
    status: STATUS.abandoned,
    createdAt: '2025-05-05T00:00:00.000Z',
  }),
  entry(me, {
    title: 'Last year',
    authors: 'Someone',
    status: STATUS.finished,
    finishedAt: '2024-12-31T23:59:59.000Z',
  }),
]

const pages: Record<string, number> = { Piranesi: 272, 'Jonathan Strange & Mr Norrell': 1006, Dune: 412 }
const genres: Record<string, string[]> = {
  Piranesi: ['Fantasy', 'Fiction', 'Mystery'],
  'Jonathan Strange & Mr Norrell': ['Fantasy', 'Historical Fiction'],
}
const facts = (e: (typeof books)[number]) => ({ pages: pages[e.value.title], genres: genres[e.value.title] })

describe('readsIn', () => {
  it('includes earlier reads and uses UTC year boundaries', () => {
    expect(readsIn(books, { kind: 'year', year: 2025 }).map((r) => r.entry.value.title)).toEqual([
      'Piranesi',
      'Jonathan Strange & Mr Norrell',
      'Dune',
    ])
    expect(readsIn(books, { kind: 'year', year: 2024 })).toHaveLength(1)
  })
})

describe('computeCovered', () => {
  const stats = computeCovered(books, { kind: 'year', year: 2025 }, facts)

  it('counts books and pages', () => {
    expect(stats.booksFinished).toBe(3)
    expect(stats.pagesRead).toBe(272 + 1006 + 412)
    expect(stats.longest?.read.entry.value.title).toBe('Jonathan Strange & Mr Norrell')
    expect(stats.shortest?.read.entry.value.title).toBe('Piranesi')
  })

  it('finds the fastest read and the average', () => {
    expect(stats.fastest).toMatchObject({ days: 1 })
    expect(stats.fastest?.read.entry.value.title).toBe('Dune')
    expect(stats.averageDays).toBeCloseTo((7 + 43 + 1) / 3)
  })

  it('ranks ratings, genres and authors, skipping broad genres', () => {
    expect(stats.topRated.map((r) => r.entry.value.stars)).toEqual([10, 8])
    expect(stats.averageRating).toBe(4.5)
    expect(stats.topGenres[0]).toEqual({ genre: 'Fantasy', count: 2 })
    expect(stats.topGenres.some((g) => g.genre === 'Fiction')).toBe(false)
    expect(stats.topAuthor).toEqual({ name: 'Susanna Clarke', count: 2 })
  })

  it('charts the year by month', () => {
    expect(stats.byMonth).toEqual([1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(stats.busiestMonth).toEqual({ month: 0, count: 1 })
    expect(stats.monthStreak).toBe(2)
  })

  it('counts starts, abandons, reviews and re-reads', () => {
    expect(stats.started).toBe(4)
    expect(stats.abandoned).toBe(1)
    expect(stats.reviewed).toBe(1)
    expect(stats.rereads).toBe(1)
  })

  it('handles a month with nothing finished', () => {
    const empty = computeCovered(books, { kind: 'month', year: 2025, month: 6 }, facts)
    expect(empty.booksFinished).toBe(0)
    expect(empty.byMonth).toBeNull()
    expect(empty.first).toBeNull()
  })
})

describe('periods', () => {
  it('lists years newest first with their months', () => {
    expect(availablePeriods(books)).toEqual([
      { year: 2025, months: [0, 2, 3] },
      { year: 2024, months: [11] },
      { year: 2019, months: [7] },
    ])
  })

  it('round-trips slugs', () => {
    expect(parsePeriodSlug(periodSlug({ kind: 'month', year: 2025, month: 2 }))).toEqual({
      kind: 'month',
      year: 2025,
      month: 2,
    })
    expect(parsePeriodSlug('2025')).toEqual({ kind: 'year', year: 2025 })
    expect(parsePeriodSlug('2025-13')).toBeNull()
  })
})

describe('daysToRead', () => {
  it('counts both ends and needs a start date', () => {
    const [read] = readsIn(books, { kind: 'month', year: 2025, month: 0 })
    expect(daysToRead(read!)).toBe(7)
    expect(daysToRead({ ...read!, startedAt: undefined })).toBeNull()
  })
})

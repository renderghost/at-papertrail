import { describe, expect, it } from 'vitest'
import { entry, profile } from '../test/fixtures'
import { STATUS } from './bookhive/types'
import { buildFeed, eventsForEntry, matchesFilter } from './feed'

const alice = profile('alice.test')
const NOW = Date.parse('2025-06-01T00:00:00.000Z')

describe('eventsForEntry', () => {
  it('emits started and finished events, with the rating on the finish', () => {
    const book = entry(alice, {
      title: 'Piranesi',
      authors: 'Susanna Clarke',
      status: STATUS.finished,
      startedAt: '2025-05-01T00:00:00.000Z',
      finishedAt: '2025-05-10T00:00:00.000Z',
      stars: 9,
      review: 'Strange and wonderful.',
    })
    const events = eventsForEntry(alice, book, NOW)
    expect(events.map((e) => e.kind)).toEqual(['started', 'finished'])
    expect(events[1]).toMatchObject({ stars: 9, review: 'Strange and wonderful.' })
  })

  it('dates a rating without a finish by the last progress update', () => {
    const book = entry(alice, {
      title: 'Ulysses',
      authors: 'James Joyce',
      status: STATUS.reading,
      stars: 4,
      bookProgress: { percent: 30, updatedAt: '2025-05-20T00:00:00.000Z' },
    })
    const rated = eventsForEntry(alice, book, NOW).find((e) => e.kind === 'rated')
    expect(rated?.date).toBe('2025-05-20T00:00:00.000Z')
  })

  it('includes earlier reads and want-to-read, and skips abandoned books', () => {
    const reread = entry(alice, {
      title: 'Dune',
      authors: 'Frank Herbert',
      status: STATUS.wantToRead,
      previousReads: [{ finishedAt: '2019-03-01T00:00:00.000Z' }],
    })
    expect(eventsForEntry(alice, reread, NOW).map((e) => [e.kind, e.earlierRead ?? false])).toEqual([
      ['finished', true],
      ['wantToRead', false],
    ])
    const dropped = entry(alice, { title: 'Moby-Dick', authors: 'Herman Melville', status: STATUS.abandoned })
    expect(eventsForEntry(alice, dropped, NOW)).toEqual([])
  })

  it('ignores dates in the future', () => {
    const book = entry(alice, {
      title: 'Future',
      authors: 'Someone',
      status: STATUS.reading,
      startedAt: '2030-01-01T00:00:00.000Z',
    })
    expect(eventsForEntry(alice, book, NOW)).toEqual([])
  })
})

describe('buildFeed', () => {
  it('orders events newest first across readers', () => {
    const bob = profile('bob.test')
    const feed = buildFeed(
      [
        { profile: alice, books: [entry(alice, { title: 'A', authors: 'X', status: STATUS.reading, startedAt: '2025-01-01T00:00:00.000Z' })] },
        { profile: bob, books: [entry(bob, { title: 'B', authors: 'Y', status: STATUS.reading, startedAt: '2025-03-01T00:00:00.000Z' })] },
      ],
      NOW,
    )
    expect(feed.map((e) => e.profile.handle)).toEqual(['bob.test', 'alice.test'])
  })
})

describe('matchesFilter', () => {
  it('counts a finish with a review as reviewed', () => {
    const book = entry(alice, {
      title: 'Piranesi',
      authors: 'Susanna Clarke',
      status: STATUS.finished,
      finishedAt: '2025-05-10T00:00:00.000Z',
      review: 'Yes.',
    })
    const [finished] = eventsForEntry(alice, book, NOW)
    expect(matchesFilter(finished!, 'reviewed')).toBe(true)
    expect(matchesFilter(finished!, 'started')).toBe(false)
  })
})

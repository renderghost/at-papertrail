import { describe, expect, it } from 'vitest'
import { STATUS, type BookEntry, type BookRecord } from './bookhive/types'
import type { ReviewEntry } from './popfeed'
import { askUrl, describeMatch, networkTake, stoppedAt, tasteMatch, tasteTwins } from './taste'

function book(did: string, hiveId: string, value: Partial<BookRecord> = {}): BookEntry {
  return {
    uri: `at://${did}/buzz.bookhive.book/${hiveId}`,
    cid: 'c',
    rkey: hiveId,
    did,
    pds: 'https://pds.test',
    value: { title: `Title ${hiveId}`, authors: 'Author', hiveId, createdAt: '2026-01-01T00:00:00.000Z', status: STATUS.finished, ...value },
  }
}

const library = (did: string, rows: [string, number | undefined, string?][]) =>
  rows.map(([id, stars, status]) => book(did, id, { ...(stars ? { stars } : {}), ...(status ? { status } : {}) }))

const profile = (did: string) => ({ did, handle: `${did.slice(8)}.test` })

describe('tasteMatch', () => {
  const mine = library('did:plc:me', [
    ['a', 10],
    ['b', 8],
    ['c', 2],
    ['d', 6],
    ['e', undefined, STATUS.abandoned],
    ['mine-only', 9],
  ])

  it('scores a reader who rates like you highly, and says why', () => {
    const twin = library('did:plc:twin', [
      ['a', 10],
      ['b', 9],
      ['c', 2],
      ['d', 6],
      ['e', undefined, STATUS.abandoned],
      ['pick', 10],
      ['meh', 4],
    ])
    const m = tasteMatch(mine, { books: twin })
    expect(m.shared).toHaveLength(5)
    expect(m.rated).toBe(4)
    expect(m.averageGap).toBeCloseTo(0.125)
    expect(m.score).toBeGreaterThanOrEqual(80)
    expect(m.bothLoved.map((s) => s.mine.value.hiveId)).toEqual(['a', 'b'])
    expect(m.theirPicks.map((b) => b.value.hiveId)).toEqual(['pick'])
    // A pick you've only added to your want-to-read list is still unread.
    const listed = tasteMatch([...mine, book('did:plc:me', 'pick', { status: STATUS.wantToRead })], { books: twin })
    expect(listed.theirPicks.map((b) => b.value.hiveId)).toEqual(['pick'])
    expect(describeMatch(m)).toEqual({ headline: `${m.score}% match (early days)`, detail: '5 books in common; you rate them almost the same' })
  })

  it('scores a reader who disagrees low, widest disagreement first', () => {
    const opposite = library('did:plc:opp', [
      ['a', 2],
      ['b', 4],
      ['c', 10],
      ['d', 6],
      ['e', 10],
    ])
    const m = tasteMatch(mine, { books: opposite })
    expect(m.score).toBeLessThan(45)
    expect(m.disagreements.map((s) => s.mine.value.hiveId)).toEqual(['a', 'c', 'b'])
  })

  it('has nothing to say with fewer than three books in common', () => {
    const m = tasteMatch(mine, { books: library('did:plc:new', [['a', 10]]) })
    expect(m.score).toBeNull()
    expect(describeMatch(m).headline).toBe('Not enough in common yet')
  })

  it('takes their rating from a PopFeed review when BookHive has none', () => {
    const theirs = library('did:plc:pf', [
      ['a', undefined],
      ['b', 8],
      ['c', 2],
    ])
    const review: ReviewEntry = { uri: 'at://x', cid: 'c', rkey: 'r', did: 'did:plc:pf', value: { creativeWorkType: 'book', rating: 10, identifiers: { hiveId: 'a' }, createdAt: '' } as ReviewEntry['value'] }
    const m = tasteMatch(mine, { books: theirs, reviews: [review] })
    expect(m.shared.find((s) => s.mine.value.hiveId === 'a')?.theirStars).toBe(10)
    expect(m.rated).toBe(3)
  })

  it('ranks the people you follow, leaving out you and anyone with nothing in common', () => {
    const readers = [
      { profile: profile('did:plc:opp'), books: library('did:plc:opp', [['a', 2], ['b', 2], ['c', 10]]) },
      { profile: profile('did:plc:twin'), books: library('did:plc:twin', [['a', 10], ['b', 8], ['c', 2]]) },
      { profile: profile('did:plc:none'), books: library('did:plc:none', [['zzz', 10]]) },
      { profile: profile('did:plc:me'), books: mine },
    ]
    expect(tasteTwins(mine, readers, 'did:plc:me').map((t) => t.reader.profile.did)).toEqual(['did:plc:twin', 'did:plc:opp'])
  })
})

describe('your network on one book', () => {
  it('sums up what readers did with it', () => {
    const entries = [
      book('did:plc:a', 'x', { stars: 10 }),
      book('did:plc:b', 'x', { stars: 7 }),
      book('did:plc:c', 'x', { status: STATUS.reading }),
      book('did:plc:d', 'x', { status: STATUS.abandoned, bookProgress: { percent: 34, updatedAt: '' } }),
    ]
    expect(networkTake(entries)).toEqual({ readers: 4, average: 4.25, loved: 1, finished: 2, reading: 1, abandoned: 1 })
    expect(stoppedAt(entries[3]!)).toBe('at 34%')
    expect(stoppedAt(book('did:plc:e', 'x', { status: STATUS.abandoned, bookProgress: { currentPage: 120, totalPages: 350, updatedAt: '' } }))).toBe('on page 120 of 350')
    expect(stoppedAt(entries[0]!)).toBeNull()
  })

  it('asks the people who read it on Bluesky, to edit before posting', () => {
    const url = new URL(askUrl('Piranesi', ['alice.test', 'bob.test'], 'https://papertrail.renderg.host/books/bk_1'))
    expect(url.origin + url.pathname).toBe('https://bsky.app/intent/compose')
    expect(url.searchParams.get('text')).toBe('@alice.test @bob.test is Piranesi worth it? 📚 https://papertrail.renderg.host/books/bk_1')
  })
})

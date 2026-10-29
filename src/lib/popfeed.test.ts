import { describe, expect, it } from 'vitest'
import { reviewMatches, toReviewEntries } from './popfeed'

const raw = (value: unknown, n = 1) => ({ uri: `at://did:plc:a/social.popfeed.feed.review/3k${n}`, cid: `bafy${n}`, value })

describe('popfeed reviews', () => {
  it('keeps book reviews and drops films, games and malformed records', () => {
    const entries = toReviewEntries('did:plc:a', [
      raw({ creativeWorkType: 'book', rating: 8, createdAt: '2026-01-01T00:00:00Z' }, 1),
      raw({ creativeWorkType: 'movie', rating: 8, createdAt: '2026-01-01T00:00:00Z' }, 2),
      raw({ creativeWorkType: 'book' }, 3),
      raw(null, 4),
    ])
    expect(entries.map((e) => e.rkey)).toEqual(['3k1'])
    expect(entries[0]).toMatchObject({ did: 'did:plc:a', value: { rating: 8 } })
  })

  it('matches a book by hiveId or by either spelling of its ISBN', () => {
    const book = { hiveId: 'bk_1', identifiers: { isbn13: '9780593135204' } }
    const at = '2026-01-01T00:00:00Z'
    expect(reviewMatches({ createdAt: at, identifiers: { hiveId: 'bk_1' } }, book)).toBe(true)
    expect(reviewMatches({ createdAt: at, identifiers: { isbn13: '9780593135204' } }, book)).toBe(true)
    expect(reviewMatches({ createdAt: at, identifiers: { isbn10: '0593135202' } }, book)).toBe(true)
    expect(reviewMatches({ createdAt: at, identifiers: { isbn13: '9781781100486' } }, book)).toBe(false)
    expect(reviewMatches({ createdAt: at }, book)).toBe(false)
    expect(reviewMatches({ createdAt: at, identifiers: { isbn13: '9780593135204' } }, { hiveId: 'bk_2' })).toBe(false)
  })
})

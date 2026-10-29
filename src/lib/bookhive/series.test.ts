import { describe, expect, it } from 'vitest'
import { describeSeries, parseSeries, ratingShares } from './series'

describe('parseSeries', () => {
  it("reads BookHive's JSON series", () => {
    const s = parseSeries('{"title":"The Green Mile","position":"2","webUrl":"https://www.goodreads.com/series/69946"}')
    expect(s).toEqual({ title: 'The Green Mile', position: '2', url: 'https://www.goodreads.com/series/69946' })
    expect(describeSeries(s!)).toBe('Book 2 of The Green Mile')
  })

  it('handles a missing position, bare names and junk', () => {
    expect(describeSeries(parseSeries('{"title":"B.P.R.D.","position":"","webUrl":""}')!)).toBe('Part of B.P.R.D.')
    expect(parseSeries('Discworld')).toEqual({ title: 'Discworld' })
    expect(parseSeries('{"position":"1"}')).toBeNull()
    expect(parseSeries('{broken')).toBeNull()
    expect(parseSeries(undefined)).toBeNull()
  })

  it('drops non-https links', () => {
    expect(parseSeries('{"title":"X","webUrl":"javascript:alert(1)"}')).toEqual({ title: 'X' })
  })
})

describe('ratingShares', () => {
  it('turns counts into shares per star', () => {
    expect(ratingShares([0, 12, 41, 85, 110])?.map((r) => Math.round(r.share * 100))).toEqual([0, 5, 17, 34, 44])
  })

  it('rejects anything that isn’t five counts', () => {
    expect(ratingShares([1, 2, 3])).toBeNull()
    expect(ratingShares([0, 0, 0, 0, 0])).toBeNull()
    expect(ratingShares('nope')).toBeNull()
  })
})

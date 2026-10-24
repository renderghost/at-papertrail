import { describe, expect, it } from 'vitest'
import { getHiveId, hiveIdCandidates, isHiveId } from './hiveId'

describe('getHiveId', () => {
  it('reproduces a real BookHive id', () => {
    // From a live buzz.bookhive.book record; the Goodreads bare title includes the subtitle.
    expect(getHiveId({ title: 'Bee Movie: The Junior Novel', authors: 'Susan Korman' })).toBe(
      'bk_FEQcl1dxSUgnRbODU6cK',
    )
  })

  it('ignores case', () => {
    expect(getHiveId({ title: 'DUNE', authors: 'FRANK HERBERT' })).toBe(
      getHiveId({ title: 'Dune', authors: 'Frank Herbert' }),
    )
  })

  it('produces ids BookHive accepts', () => {
    expect(isHiveId(getHiveId({ title: 'Piranesi', authors: 'Susanna Clarke' }))).toBe(true)
    expect(isHiveId('null')).toBe(false)
  })
})

describe('hiveIdCandidates', () => {
  it('tries "Title: Subtitle" before the bare title', () => {
    const ids = hiveIdCandidates({ title: 'Bee Movie', subtitle: 'The Junior Novel', firstAuthor: 'Susan Korman' })
    expect(ids).toEqual([
      'bk_FEQcl1dxSUgnRbODU6cK',
      getHiveId({ title: 'Bee Movie', authors: 'Susan Korman' }),
    ])
  })

  it('returns one id when there is no subtitle', () => {
    expect(hiveIdCandidates({ title: 'Dune', firstAuthor: 'Frank Herbert' })).toHaveLength(1)
  })
})

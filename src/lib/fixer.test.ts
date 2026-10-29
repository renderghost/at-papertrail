import { describe, expect, it } from 'vitest'
import { STATUS, type BookEntry, type BookRecord } from './bookhive/types'
import { choosePrimary, findDuplicates, mergeRecords, rematchRecord } from './fixer'

function entry(rkey: string, value: Partial<BookRecord>): BookEntry {
  return {
    uri: `at://did:plc:me/buzz.bookhive.book/${rkey}`,
    cid: `cid-${rkey}`,
    rkey,
    did: 'did:plc:me',
    pds: 'https://pds.test',
    value: { title: 'Dune', authors: 'Frank Herbert', hiveId: `bk_${rkey}`, createdAt: '2025-01-01T00:00:00.000Z', ...value },
  }
}

describe('findDuplicates', () => {
  it('groups the same book by hiveId, ISBN (either form) or title and first author', () => {
    const a = entry('a', { identifiers: { isbn13: '9780441013593' } })
    const b = entry('b', { title: 'Dune (Deluxe)', identifiers: { isbn10: '0441013597' } })
    const c = entry('c', { title: 'The Dune', authors: 'Frank Herbert\tBrian Herbert' })
    const other = entry('d', { title: 'Children of Dune' })
    const groups = findDuplicates([a, b, c, other])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.map((e) => e.rkey).sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('choosePrimary and mergeRecords', () => {
  it('keeps the catalogued, fuller record and folds in the other one', () => {
    const imported = entry('imp', {
      createdAt: '2019-01-01T00:00:00.000Z',
      status: STATUS.finished,
      finishedAt: '2019-05-01T00:00:00.000Z',
      stars: 6,
      owned: true,
      identifiers: { isbn13: '9780441013593' },
    })
    const mine = entry('mine', {
      hiveBookUri: 'at://did:plc:enu2j5xjlqsjaylv3du4myh4/buzz.bookhive.catalogBook/bk_mine',
      status: STATUS.finished,
      finishedAt: '2025-02-15T00:00:00.000Z',
      review: 'Spice.',
    })
    const primary = choosePrimary([imported, mine])
    expect(primary.rkey).toBe('mine')
    const merged = mergeRecords(primary.value, [imported.value])
    expect(merged).toMatchObject({
      hiveId: 'bk_mine',
      status: STATUS.finished,
      finishedAt: '2025-02-15T00:00:00.000Z',
      previousReads: [{ finishedAt: '2019-05-01T00:00:00.000Z' }],
      stars: 6,
      review: 'Spice.',
      owned: true,
      identifiers: { isbn13: '9780441013593' },
      createdAt: '2019-01-01T00:00:00.000Z',
    })
  })
})

describe('rematchRecord', () => {
  it('points the record at the catalogue book and keeps the reading', () => {
    const record = entry('x', { title: 'dune', status: STATUS.reading, startedAt: '2026-10-01T00:00:00.000Z', identifiers: { goodreadsId: '1' } }).value
    const next = rematchRecord(record, { id: 'bk_real', title: 'Dune', authors: 'Frank Herbert', thumbnail: '', identifiers: { isbn13: '9780441013593' } })
    expect(next).toMatchObject({
      title: 'Dune',
      hiveId: 'bk_real',
      status: STATUS.reading,
      startedAt: '2026-10-01T00:00:00.000Z',
      identifiers: { goodreadsId: '1', isbn13: '9780441013593', hiveId: 'bk_real' },
      hiveBookUri: 'at://did:plc:enu2j5xjlqsjaylv3du4myh4/buzz.bookhive.catalogBook/bk_real',
    })
  })
})

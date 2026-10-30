import { describe, expect, it } from 'vitest'
import { describeBatch, planBatch, withStatus } from './batch'
import { STATUS, STATUS_LABEL, type BookEntry, type BookRecord, type BookStatus } from './bookhive/types'
import type { BookList } from './lists'

const NOW = '2026-10-30T10:00:00.000Z'
let n = 0
const tid = () => `3ltid${++n}`

function entry(hiveId: string, value: Partial<BookRecord> = {}): BookEntry {
  return {
    uri: `at://did:plc:me/buzz.bookhive.book/${hiveId}`,
    cid: 'c',
    rkey: hiveId,
    did: 'did:plc:me',
    pds: 'https://pds.test',
    value: { title: `Title ${hiveId}`, authors: 'Author', hiveId, createdAt: '2026-01-01T00:00:00.000Z', ...value },
  }
}

const label = (s: BookStatus) => STATUS_LABEL[s]

describe('planBatch', () => {
  it('sets a status with the same dates the book page would, skipping books already there, and can undo it', () => {
    const books = [entry('a', { status: STATUS.wantToRead }), entry('b', { status: STATUS.finished, finishedAt: '2026-05-01T00:00:00.000Z' }), entry('c', { status: STATUS.reading, startedAt: '2026-10-01T00:00:00.000Z' })]
    const plan = planBatch(books, { kind: 'status', status: STATUS.finished }, { now: () => NOW })
    expect(plan.changed).toBe(2)
    expect(plan.writes.map((w) => [w.rkey, w.$type.split('#')[1], (w as { value: BookRecord }).value.finishedAt])).toEqual([
      ['a', 'update', NOW],
      ['c', 'update', NOW],
    ])
    // Reading keeps its start date.
    expect((plan.writes[1] as { value: BookRecord }).value.startedAt).toBe('2026-10-01T00:00:00.000Z')
    expect(plan.undo.map((w) => (w as { value: BookRecord }).value)).toEqual([books[0]!.value, books[2]!.value])
    expect(describeBatch({ kind: 'status', status: STATUS.finished }, plan.changed, label)).toBe('Moved 2 books to Read')
  })

  it('reading a finished book again keeps the earlier read', () => {
    const plan = planBatch([entry('a', { status: STATUS.finished, startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-02-01T00:00:00.000Z' })], { kind: 'status', status: STATUS.reading }, { now: () => NOW })
    const next = (plan.writes[0] as { value: BookRecord }).value
    expect(next).toMatchObject({ status: STATUS.reading, startedAt: NOW, previousReads: [{ startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-02-01T00:00:00.000Z' }] })
    expect(next.finishedAt).toBeUndefined()
  })

  it('marks books owned or not, touching nothing else', () => {
    const books = [entry('a', { owned: true, stars: 8 }), entry('b', { stars: 6 })]
    const owned = planBatch(books, { kind: 'owned', owned: true })
    expect(owned.writes).toEqual([{ $type: 'com.atproto.repo.applyWrites#update', collection: 'buzz.bookhive.book', rkey: 'b', value: { ...books[1]!.value, $type: 'buzz.bookhive.book', owned: true } }])
    const notOwned = planBatch(books, { kind: 'owned', owned: false })
    expect((notOwned.writes[0] as { value: BookRecord }).value).not.toHaveProperty('owned')
    expect((notOwned.writes[0] as { value: BookRecord }).value.stars).toBe(8)
  })

  it('adds books to a list once, at the end of an ordered one, and undo deletes just what it added', () => {
    const list = {
      uri: 'at://did:plc:me/social.popfeed.feed.list/l1',
      cid: 'c',
      rkey: 'l1',
      value: { $type: 'social.popfeed.feed.list', name: 'Weekend reads', ordered: true, itemOrder: ['at://did:plc:me/social.popfeed.feed.listItem/i1'], createdAt: NOW },
      items: [{ uri: 'at://did:plc:me/social.popfeed.feed.listItem/i1', cid: 'c', rkey: 'i1', value: { identifiers: { hiveId: 'a' }, listUri: 'at://did:plc:me/social.popfeed.feed.list/l1' } }],
    } as unknown as BookList
    const plan = planBatch([entry('a'), entry('b'), entry('c')], { kind: 'list', list }, { now: () => NOW, tid })
    expect(plan.changed).toBe(2)
    expect(plan.writes.map((w) => w.$type.split('#')[1] + ' ' + w.collection)).toEqual([
      'create social.popfeed.feed.listItem',
      'create social.popfeed.feed.listItem',
      'update social.popfeed.feed.list',
    ])
    const order = (plan.writes[2] as { value: { itemOrder: string[] } }).value.itemOrder
    expect(order).toHaveLength(3)
    expect(order[0]).toBe('at://did:plc:me/social.popfeed.feed.listItem/i1')
    expect(plan.undo.map((w) => w.$type.split('#')[1])).toEqual(['delete', 'delete', 'update'])
    expect(describeBatch({ kind: 'list', list }, plan.changed, label)).toBe('Added 2 books to Weekend reads')
  })

  it('removes books, and undo puts them back under the same keys', () => {
    const books = [entry('a', { stars: 10 })]
    const plan = planBatch(books, { kind: 'remove' })
    expect(plan.writes).toEqual([{ $type: 'com.atproto.repo.applyWrites#delete', collection: 'buzz.bookhive.book', rkey: 'a' }])
    expect(plan.undo).toEqual([{ $type: 'com.atproto.repo.applyWrites#create', collection: 'buzz.bookhive.book', rkey: 'a', value: books[0]!.value }])
    expect(describeBatch({ kind: 'remove' }, 1, label)).toBe('Removed 1 book from your library')
  })
})

describe('withStatus', () => {
  it('stamps the date a book enters a status, and keeps the others', () => {
    const want = entry('a', { status: STATUS.wantToRead, stars: 8, owned: true }).value
    const reading = withStatus(want, STATUS.reading, () => NOW)
    expect(reading).toMatchObject({ status: STATUS.reading, startedAt: NOW, stars: 8, owned: true })
    const read = withStatus(reading, STATUS.finished, () => '2026-11-02T10:00:00.000Z')
    expect(read).toMatchObject({ status: STATUS.finished, startedAt: NOW, finishedAt: '2026-11-02T10:00:00.000Z' })
    // Abandoning keeps how far you got.
    const stopped = withStatus({ ...reading, bookProgress: { percent: 34, updatedAt: NOW } }, STATUS.abandoned, () => NOW)
    expect(stopped).toMatchObject({ status: STATUS.abandoned, bookProgress: { percent: 34 } })
  })
})


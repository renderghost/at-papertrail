import { describe, expect, it, vi } from 'vitest'
import {
  addToList,
  buildLists,
  clipBytes,
  createList,
  deleteList,
  isPopfeedShelf,
  itemIsBook,
  LIST,
  LIST_ITEM,
  listTags,
  newListItem,
  notInterestedIds,
  notInterestedList,
  orderItems,
  parseTags,
  removeFromList,
  reorderList,
  repointWrites,
  updateList,
  type BookList,
  type ListItem,
} from './lists'
import type { SessionFetch } from './xrpc'

const DID = 'did:plc:me'
const listUri = (rkey: string) => `at://${DID}/${LIST}/${rkey}`
const itemUri = (rkey: string) => `at://${DID}/${LIST_ITEM}/${rkey}`

function item(rkey: string, list: string, extra: Record<string, unknown> = {}) {
  return {
    uri: itemUri(rkey),
    cid: `cid-${rkey}`,
    value: { creativeWorkType: 'book', identifiers: { hiveId: `bk_${rkey}` }, listUri: list, addedAt: '2026-01-01T00:00:00Z', ...extra },
  }
}

function session(results: unknown[] = []): SessionFetch & { calls: { nsid: string; body: any }[] } {
  const calls: { nsid: string; body: any }[] = []
  return {
    did: DID,
    calls,
    fetchHandler: vi.fn(async (path: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      calls.push({ nsid: path.replace('/xrpc/', ''), body })
      return new Response(JSON.stringify({ results, uri: listUri('new'), cid: 'cid-new' }), { status: 200 })
    }),
  }
}

describe('buildLists', () => {
  it('groups book items under their list and leaves out film lists and bridged shelves', () => {
    const lists = buildLists(
      DID,
      [
        { uri: listUri('a'), cid: 'ca', value: { name: 'Sci-fi', createdAt: '2026-02-01T00:00:00Z' } },
        { uri: listUri('m'), cid: 'cm', value: { name: 'Movie Watchlist', listType: 'movie_watchlist', createdAt: '2026-03-01T00:00:00Z' } },
        { uri: listUri('w'), cid: 'cw', value: { name: 'Watchlist', createdAt: '2026-01-15T00:00:00Z' } },
        { uri: listUri('e'), cid: 'ce', value: { name: 'Empty', createdAt: '2026-01-10T00:00:00Z' } },
        { uri: listUri('bad'), cid: 'cb', value: { title: 'not a list' } },
      ],
      [
        item('1', listUri('a')),
        item('2', listUri('a')),
        { ...item('3', listUri('w')), value: { ...item('3', listUri('w')).value, creativeWorkType: 'movie' } },
        { ...item('4', 'bridge://bookhive/did:plc:me/current'), value: { ...item('4', 'bridge://bookhive/did:plc:me/current').value } },
      ],
    )
    expect(lists.map((l) => l.value.name)).toEqual(['Sci-fi', 'Empty'])
    expect(lists[0]!.items).toHaveLength(2)
  })

  it("recognises PopFeed's own shelves", () => {
    expect(isPopfeedShelf({ value: { name: 'Read', listType: 'read_books', createdAt: '' } })).toBe(true)
    expect(isPopfeedShelf({ value: { name: 'Mine', createdAt: '' } })).toBe(false)
  })
})

describe('orderItems', () => {
  const a = { ...item('a', 'l'), rkey: 'a', value: { ...item('a', 'l').value, addedAt: '2026-01-01T00:00:00Z' } } as ListItem
  const b = { ...item('b', 'l'), rkey: 'b', value: { ...item('b', 'l').value, addedAt: '2026-02-01T00:00:00Z' } } as ListItem
  const c = { ...item('c', 'l'), rkey: 'c', value: { ...item('c', 'l').value, addedAt: '2026-03-01T00:00:00Z', position: 0 } } as ListItem

  it("uses bookhive.buzz's fallback: position, then newest first", () => {
    expect(orderItems({ name: 'x', createdAt: '' }, [a, b, c]).map((i) => i.rkey)).toEqual(['c', 'b', 'a'])
  })

  it('puts itemOrder first on ordered lists, then the rest in fallback order', () => {
    const list = { name: 'x', createdAt: '', ordered: true, itemOrder: [a.uri, b.uri] }
    expect(orderItems(list, [c, b, a]).map((i) => i.rkey)).toEqual(['a', 'b', 'c'])
    expect(orderItems({ ...list, ordered: false }, [c, b, a]).map((i) => i.rkey)).toEqual(['c', 'b', 'a'])
  })
})

describe('items', () => {
  it("writes BookHive's item shape", () => {
    const value = newListItem(
      listUri('a'),
      { hiveId: 'bk_1', title: 'Dune', authors: 'Frank Herbert\tBrian Herbert', identifiers: { isbn13: '9780441013593' }, coverUrl: 'https://x/c.jpg' },
      ' A classic. ',
      () => '2026-10-29T00:00:00.000Z',
    )
    expect(value).toEqual({
      $type: LIST_ITEM,
      creativeWorkType: 'book',
      identifiers: { hiveId: 'bk_1', isbn13: '9780441013593' },
      title: 'Dune',
      mainCredit: 'Frank Herbert',
      mainCreditRole: 'author',
      posterUrl: 'https://x/c.jpg',
      listUri: listUri('a'),
      addedAt: '2026-10-29T00:00:00.000Z',
      description: 'A classic.',
    })
  })

  it('matches an item to a book by hiveId, else ISBN', () => {
    const it1 = { ...item('1', 'l'), rkey: '1' } as ListItem
    expect(itemIsBook(it1, { hiveId: 'bk_1' })).toBe(true)
    expect(itemIsBook(it1, { hiveId: 'bk_2' })).toBe(false)
    const byIsbn = { ...it1, value: { ...it1.value, identifiers: { isbn13: '978' } } }
    expect(itemIsBook(byIsbn, { hiveId: 'bk_9', identifiers: { isbn13: '978' } })).toBe(true)
  })
})

describe('writes', () => {
  const base: BookList = {
    uri: listUri('l'),
    cid: 'cl',
    rkey: 'l',
    did: DID,
    value: { name: 'Ranked', createdAt: '2026-01-01T00:00:00Z', ordered: true, itemOrder: [itemUri('1')], futureField: 1 },
    items: [{ ...item('1', listUri('l')), rkey: '1' } as ListItem],
  }

  it('adds to an ordered list by writing the item and the new order together', async () => {
    const s = session([{ uri: 'x', cid: 'cid-item' }, { uri: base.uri, cid: 'cid-list2' }])
    const next = await addToList(s, base, { hiveId: 'bk_2', title: 'Two', authors: 'A' })
    expect(s.calls).toHaveLength(1)
    const { writes } = s.calls[0]!.body
    expect(writes.map((w: any) => w.$type.split('#')[1])).toEqual(['create', 'update'])
    expect(writes[1].value.itemOrder).toEqual([itemUri('1'), `at://${DID}/${LIST_ITEM}/${writes[0].rkey}`])
    expect(writes[1].value.futureField).toBe(1)
    expect(next.items.map((i) => i.value.identifiers.hiveId)).toEqual(['bk_1', 'bk_2'])
    expect(next.cid).toBe('cid-list2')
  })

  it('adds to an unordered list with one write', async () => {
    const s = session([{ uri: 'x', cid: 'cid-item' }])
    await addToList(s, { ...base, value: { name: 'Loose', createdAt: '' } }, { hiveId: 'bk_2', title: 'Two', authors: 'A' })
    expect(s.calls[0]!.body.writes).toHaveLength(1)
  })

  it('removes an item and drops it from the order', async () => {
    const s = session([{}, { uri: base.uri, cid: 'cid-list3' }])
    const next = await removeFromList(s, base, base.items[0]!)
    const { writes } = s.calls[0]!.body
    expect(writes[0]).toMatchObject({ $type: 'com.atproto.repo.applyWrites#delete', collection: LIST_ITEM, rkey: '1' })
    expect(writes[1].value.itemOrder).toEqual([])
    expect(next.items).toHaveLength(0)
  })

  it('deletes a list with its items', async () => {
    const s = session()
    await deleteList(s, base)
    expect(s.calls[0]!.body.writes.map((w: any) => w.collection)).toEqual([LIST_ITEM, LIST])
  })

  it('reorders with a compare-and-swap put', async () => {
    const s = session()
    await reorderList(s, base, [itemUri('1')])
    expect(s.calls[0]).toMatchObject({ nsid: 'com.atproto.repo.putRecord', body: { swapRecord: 'cl', record: { ordered: true } } })
  })

  it('creates a list with its tags, held to the lexicon limits', async () => {
    const s = session()
    const list = await createList(s, { name: `  ${'é'.repeat(60)}  `, description: ' ', tags: ['cosy'] }, () => 'now')
    const record = s.calls[0]!.body.record
    expect(new TextEncoder().encode(record.name).length).toBe(100)
    expect(record).not.toHaveProperty('description')
    expect(record).toMatchObject({ $type: LIST, tags: ['cosy'], ordered: false, createdAt: 'now' })
    expect(list.rkey).toBe('new')
  })

  it('updates only what it is given, keeping tags it did not touch', async () => {
    const s = session()
    const tagged = { ...base, value: { ...base.value, tags: Array.from({ length: 12 }, (_, i) => `t${i}`) } }
    await updateList(s, tagged, { name: 'Renamed', description: '' })
    const record = s.calls[0]!.body.record
    expect(record.name).toBe('Renamed')
    expect(record.tags).toHaveLength(12)
    expect(record).not.toHaveProperty('description')
  })
})

describe('tags', () => {
  it('parses what people type', () => {
    expect(parseTags(' cosy, #Winter reads,, cosy , COSY,#  ')).toEqual(['cosy', 'Winter reads'])
    expect(parseTags(Array.from({ length: 15 }, (_, i) => `t${i}`).join(','))).toHaveLength(10)
    expect(new TextEncoder().encode(parseTags('ü'.repeat(40))[0]).length).toBe(50)
  })

  it('reads stored tags defensively', () => {
    expect(listTags({ name: 'x', createdAt: '', tags: ['a', '', 3, ' '] as unknown as string[] })).toEqual(['a'])
    expect(listTags({ name: 'x', createdAt: '' })).toEqual([])
  })
})

describe('clipBytes', () => {
  it('counts UTF-8 bytes and never splits a character', () => {
    expect(clipBytes('abc', 3)).toBe('abc')
    expect(clipBytes('aé', 2)).toBe('a')
    expect(clipBytes('📚📚', 5)).toBe('📚')
  })
})

describe('repointWrites', () => {
  const ranked: BookList = {
    uri: listUri('r'),
    cid: 'cr',
    rkey: 'r',
    did: DID,
    value: { name: 'Ranked', createdAt: '', ordered: true, itemOrder: [itemUri('old'), itemUri('new')] },
    items: [
      { ...item('old', listUri('r')), rkey: 'old', value: { ...item('old', listUri('r')).value, identifiers: { hiveId: 'bk_old' } } } as ListItem,
      { ...item('new', listUri('r')), rkey: 'new', value: { ...item('new', listUri('r')).value, identifiers: { hiveId: 'bk_new' } } } as ListItem,
    ],
  }
  const to = { hiveId: 'bk_new', title: 'New Title', authors: 'A\tB', identifiers: { isbn13: '9780441013593' } }

  it('updates an item in place when the list lacks the new book', () => {
    const list = { ...ranked, items: [ranked.items[0]!], value: { ...ranked.value, itemOrder: [itemUri('old')] } }
    const writes = repointWrites(list, new Set(['bk_old']), to)
    expect(writes).toEqual([
      expect.objectContaining({
        $type: 'com.atproto.repo.applyWrites#update',
        collection: LIST_ITEM,
        rkey: 'old',
        value: expect.objectContaining({ identifiers: { hiveId: 'bk_new', isbn13: '9780441013593' }, title: 'New Title', mainCredit: 'A' }),
      }),
    ])
  })

  it('deletes the old item, and drops it from the order, when the list already has the new book', () => {
    const writes = repointWrites(ranked, new Set(['bk_old']), to)
    expect(writes.map((w) => w.$type.split('#')[1])).toEqual(['delete', 'update'])
    expect((writes[1] as { value: { itemOrder: string[] } }).value.itemOrder).toEqual([itemUri('new')])
  })

  it('does nothing for lists without the old book', () => {
    expect(repointWrites(ranked, new Set(['bk_absent']), to)).toEqual([])
  })
})

describe('Not Interested', () => {
  const lists = buildLists(
    DID,
    [
      { uri: listUri('l1'), cid: 'c1', value: { name: 'Weekend reads', createdAt: '2026-01-01T00:00:00Z' } },
      { uri: listUri('l2'), cid: 'c2', value: { name: ' not interested ', createdAt: '2026-01-02T00:00:00Z' } },
      { uri: listUri('l3'), cid: 'c3', value: { name: 'Not Interested', listType: 'not_interested', createdAt: '2026-01-03T00:00:00Z' } },
    ],
    [item('i1', listUri('l2')), item('i2', listUri('l2'), { identifiers: { isbn13: '9780000000002' } }), item('i3', listUri('l1'))],
  )

  it('is your own list of that name, whatever its case, never a PopFeed shelf', () => {
    expect(notInterestedList(lists)?.rkey).toBe('l2')
    expect(notInterestedList(lists.filter((l) => l.rkey !== 'l2'))).toBeUndefined()
  })

  it('leaves out the books on it by hiveId', () => {
    expect(notInterestedIds(notInterestedList(lists))).toEqual(['bk_i1'])
    expect(notInterestedIds(undefined)).toEqual([])
  })
})


import { beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryStore } from '../cache'
import { catalogSeries, fetchCatalogBook } from './catalog'

const getRecord = vi.hoisted(() => vi.fn())
vi.mock('../atproto', async (original) => ({ ...(await original<typeof import('../atproto')>()), getRecord }))
vi.mock('../identity', () => ({ resolvePds: async () => 'https://pds.test' }))

const record = (series?: string) => ({ uri: 'at://x', cid: 'c', value: { id: 'bk', title: 'T', authors: 'A', ...(series ? { series } : {}) } })

beforeEach(() => getRecord.mockReset())

describe('catalogue lookups', () => {
  it("remembers a book BookHive hasn't catalogued, so it isn't asked for again", async () => {
    const cache = memoryStore()
    getRecord.mockResolvedValue(null)
    expect(await fetchCatalogBook('bk_missing', { cache })).toBeNull()
    expect(await fetchCatalogBook('bk_missing', { cache })).toBeNull()
    expect(getRecord).toHaveBeenCalledTimes(1)
    // The match fixer can still ask afresh.
    getRecord.mockResolvedValue(record())
    expect(await fetchCatalogBook('bk_missing', { cache, fresh: true })).not.toBeNull()
  })

  it("doesn't remember a failure as a miss", async () => {
    const cache = memoryStore()
    getRecord.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(record())
    await expect(fetchCatalogBook('bk_flaky', { cache })).rejects.toThrow('offline')
    expect(await fetchCatalogBook('bk_flaky', { cache })).not.toBeNull()
  })

  it('asks once for a book wanted twice at the same time', async () => {
    getRecord.mockResolvedValue(record())
    const [a, b] = await Promise.all([fetchCatalogBook('bk_twice', { cache: memoryStore() }), fetchCatalogBook('bk_twice', { cache: memoryStore() })])
    expect(a).toEqual(b)
    expect(getRecord).toHaveBeenCalledTimes(1)
  })

  it('knows a series from an earlier lookup without asking again', async () => {
    const cache = memoryStore()
    const series = JSON.stringify({ title: 'Earthsea Cycle', position: '2' })
    getRecord.mockResolvedValue(record(series))
    await fetchCatalogBook('bk_tombs', { cache })
    expect(await catalogSeries('bk_tombs', cache)).toBe(series)
    getRecord.mockResolvedValue(null)
    expect(await catalogSeries('bk_none', cache)).toBeNull()
    expect(await catalogSeries('bk_none', cache)).toBeNull()
    expect(getRecord).toHaveBeenCalledTimes(2)
  })
})

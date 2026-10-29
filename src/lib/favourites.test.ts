import { describe, expect, it, vi } from 'vitest'
import {
  favouriteBooks,
  MAX_FAVOURITES,
  POPFEED_PROFILE,
  saveFavourites,
  toFavourite,
  withFavourites,
  type ProfileRecord,
} from './favourites'

describe('favourites', () => {
  const existing: ProfileRecord = {
    cid: 'cid-1',
    value: {
      $type: POPFEED_PROFILE,
      displayName: 'Barry',
      externalLinks: [{ url: 'https://renderg.host' }],
      favorites: { movies: [{ title: 'Alien' }], books: [{ title: 'Dune', identifiers: { isbn13: '978' }, creativeWorkType: 'book' as const }] },
      createdAt: '2025-01-01T00:00:00Z',
    },
  }

  it('reads favourite books and ignores malformed entries', () => {
    expect(favouriteBooks(existing).map((b) => b.title)).toEqual(['Dune'])
    expect(favouriteBooks({ cid: 'x', value: { favorites: { books: [null as never, { title: 'x' } as never] } } })).toEqual([])
    expect(favouriteBooks(null)).toEqual([])
  })

  it('changes only the books, keeping the rest of the profile and other media', () => {
    const next = withFavourites(existing, [toFavourite({ hiveId: 'bk_1', title: 'Piranesi', identifiers: { isbn10: '1635575630' } })])
    expect(next.displayName).toBe('Barry')
    expect(next.externalLinks).toEqual([{ url: 'https://renderg.host' }])
    expect(next.favorites?.movies).toEqual([{ title: 'Alien' }])
    expect(next.favorites?.books).toEqual([
      { title: 'Piranesi', identifiers: { hiveId: 'bk_1', isbn10: '1635575630' }, creativeWorkType: 'book' },
    ])
  })

  it('starts a profile record when there is none, and caps the list', () => {
    const many = Array.from({ length: 14 }, (_, i) => toFavourite({ hiveId: `bk_${i}`, title: `B${i}` }))
    const next = withFavourites(null, many, () => '2026-10-29T00:00:00Z')
    expect(next).toMatchObject({ $type: POPFEED_PROFILE, createdAt: '2026-10-29T00:00:00Z' })
    expect(next.favorites?.books).toHaveLength(MAX_FAVOURITES)
  })

  it('saves with a compare-and-swap put (asserting absence for a new record)', async () => {
    const calls: any[] = []
    const session = {
      did: 'did:plc:me',
      fetchHandler: vi.fn(async (_p: string, init?: RequestInit) => {
        calls.push(JSON.parse(String(init?.body)))
        return new Response(JSON.stringify({ cid: 'cid-2' }), { status: 200 })
      }),
    }
    await saveFavourites(session, existing, [])
    await saveFavourites(session, null, [])
    expect(calls[0]).toMatchObject({ collection: POPFEED_PROFILE, rkey: 'self', swapRecord: 'cid-1' })
    expect(calls[1].swapRecord).toBeNull()
  })
})

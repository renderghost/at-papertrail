import { describe, expect, it, vi } from 'vitest'
import { entry, profile } from '../test/fixtures'
import { memoryStore } from './cache'
import { NetworkStore, type NetworkDeps, type NetworkState } from './network'
import type { ReviewEntry } from './popfeed'

const me = 'did:plc:me'
const alice = profile('alice.test')
const bob = profile('bob.test')
const carol = profile('carol.test')

function review(did: string): ReviewEntry {
  return {
    uri: `at://${did}/social.popfeed.feed.review/3k1`,
    cid: 'bafyr',
    rkey: '3k1',
    did,
    value: { creativeWorkType: 'book', rating: 8, createdAt: '2026-01-01T00:00:00Z', identifiers: { isbn13: '9780593135204' } },
  }
}

function deps(overrides: Partial<NetworkDeps> = {}): NetworkDeps & { revs: Map<string, string> } {
  const revs = new Map([
    [alice.did, 'rev-a1'],
    [bob.did, 'rev-b1'],
    [carol.did, 'rev-c1'],
  ])
  return {
    revs,
    getFollows: vi.fn(async () => [alice, bob, carol]),
    // Alice and Carol use BookHive; Bob only reviews on PopFeed.
    listReposWithCollection: vi.fn(async (collection: string) =>
      collection === 'buzz.bookhive.book' ? new Set([alice.did, carol.did]) : new Set([bob.did]),
    ),
    resolvePds: vi.fn(async () => 'https://pds.example'),
    latestRev: vi.fn(async (_pds: string, did: string) => revs.get(did)!),
    loadBooks: vi.fn(async (did: string) => (did === alice.did ? [entry(alice, { title: 'Dune', authors: 'Frank Herbert' })] : [])),
    loadReviews: vi.fn(async (did: string) => [review(did)]),
    rememberPds: vi.fn(),
    forgetPds: vi.fn(),
    cache: memoryStore(),
    now: () => 1_000_000,
    ...overrides,
  }
}

function settle(store: NetworkStore): Promise<NetworkState> {
  return new Promise((resolve) => {
    const check = () => {
      const s = store.getSnapshot()
      if (s.status === 'done' || s.status === 'error') {
        unsubscribe()
        resolve(s)
      }
    }
    const unsubscribe = store.subscribe(check)
    check()
  })
}

describe('NetworkStore', () => {
  it('reads books from BookHive users and reviews from PopFeed users, and skips everyone else', async () => {
    const d = deps()
    const store = new NetworkStore(d)
    store.load(me)
    const state = await settle(store)
    expect(state.usedIndex).toBe(true)
    expect(state.toScan).toBe(3)
    expect(state.readers.map((r) => r.profile.handle).sort()).toEqual(['alice.test', 'bob.test'])
    expect(d.loadBooks).toHaveBeenCalledTimes(2) // Alice and Carol
    expect(d.loadReviews).toHaveBeenCalledTimes(1) // Bob
    expect(state.readers.find((r) => r.profile.did === bob.did)!.reviews).toHaveLength(1)
  })

  it('shows the stored copy at once on reload, and only re-reads repos whose commit changed', async () => {
    const d = deps()
    await (async () => {
      const first = new NetworkStore(d)
      first.load(me)
      await settle(first)
    })()
    vi.mocked(d.loadBooks).mockClear()
    vi.mocked(d.loadReviews).mockClear()
    d.revs.set(alice.did, 'rev-a2') // Alice added a book; Bob and Carol didn't change.
    // Hold the refresh at the follows lookup, so the stored copy can be seen first.
    let release!: () => void
    vi.mocked(d.getFollows).mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve([alice, bob, carol]))),
    )

    const second = new NetworkStore(d)
    second.load(me)
    await vi.waitFor(() => expect(second.getSnapshot().cachedAt).toBe(1_000_000))
    expect(second.getSnapshot().status).toBe('loading')
    expect(second.getSnapshot().readers).toHaveLength(2)
    release()

    const state = await settle(second)
    expect(state.cachedAt).toBeUndefined()
    expect(d.loadBooks).toHaveBeenCalledTimes(1)
    expect(d.loadBooks).toHaveBeenCalledWith(alice.did, expect.anything())
    expect(d.loadReviews).not.toHaveBeenCalled()
    // The stored PDS is reused instead of resolving the DID again.
    expect(d.rememberPds).toHaveBeenCalledWith(bob.did, 'https://pds.example')
  })

  it('re-resolves a stored PDS that no longer answers', async () => {
    const d = deps()
    const first = new NetworkStore(d)
    first.load(me)
    await settle(first)
    vi.mocked(d.latestRev).mockImplementation(async (pds, did) => {
      if (pds === 'https://pds.example') throw new Error('moved')
      return d.revs.get(did)!
    })
    vi.mocked(d.resolvePds).mockResolvedValue('https://new-pds.example')
    const second = new NetworkStore(d)
    second.load(me)
    const state = await settle(second)
    expect(d.forgetPds).toHaveBeenCalledWith(alice.did)
    expect(state.failed).toBe(0)
    expect(state.readers).toHaveLength(2)
  })

  it('checks every follow for books when the relay index is unavailable, without PopFeed', async () => {
    const d = deps({ listReposWithCollection: vi.fn(async () => null) })
    const store = new NetworkStore(d)
    store.load(me)
    const state = await settle(store)
    expect(state.usedIndex).toBe(false)
    expect(d.loadBooks).toHaveBeenCalledTimes(3)
    expect(d.loadReviews).not.toHaveBeenCalled()
  })

  it('forgets the stored copies on reset (sign-out)', async () => {
    const d = deps()
    const store = new NetworkStore(d)
    store.load(me)
    await settle(store)
    // The copy is saved just after the scan reports done.
    await vi.waitFor(async () => expect(await d.cache.get('network:did:plc:me')).toBeDefined())
    store.reset()
    await vi.waitFor(async () => expect(await d.cache.get('network:did:plc:me')).toBeUndefined())
    expect(store.getSnapshot().status).toBe('idle')
  })
})

import { describe, expect, it, vi } from 'vitest'
import { parseSuggestions, searchActors, SUGGESTION_LIMIT, typeaheadQuery } from './typeahead'

describe('typeaheadQuery', () => {
  it('searches what people type, without a leading @', () => {
    expect(typeaheadQuery('  @Alice.bsky ')).toBe('alice.bsky')
    expect(typeaheadQuery('B. Prender')).toBe('b. prender')
  })

  it('skips empty text, DIDs and very long text', () => {
    expect(typeaheadQuery('')).toBeNull()
    expect(typeaheadQuery(' @ ')).toBeNull()
    expect(typeaheadQuery('did:plc:abc')).toBeNull()
    expect(typeaheadQuery('a'.repeat(65))).toBeNull()
  })
})

describe('parseSuggestions', () => {
  it('keeps usable accounts once each, with https images only', () => {
    const out = parseSuggestions({
      actors: [
        { did: 'did:plc:a', handle: 'Alice.Test', displayName: ' Alice ', avatar: 'https://cdn/a.jpg', avatarFallback: 'https://pds/a' },
        { did: 'did:plc:a', handle: 'alice.test' },
        { did: 'did:plc:b', handle: 'handle.invalid' },
        { did: 'nope', handle: 'bob.test' },
        { did: 'did:plc:c', handle: 'carol.test', displayName: '', avatar: 'http://insecure/c.jpg' },
        null,
      ],
    })
    expect(out).toEqual([
      { did: 'did:plc:a', handle: 'alice.test', displayName: 'Alice', avatar: 'https://cdn/a.jpg', avatarFallback: 'https://pds/a' },
      { did: 'did:plc:c', handle: 'carol.test' },
    ])
  })

  it('caps the list and tolerates odd bodies', () => {
    const actors = Array.from({ length: 10 }, (_, i) => ({ did: `did:plc:${i}`, handle: `u${i}.test` }))
    expect(parseSuggestions({ actors })).toHaveLength(SUGGESTION_LIMIT)
    expect(parseSuggestions(null)).toEqual([])
    expect(parseSuggestions({ error: 'RateLimitExceeded' })).toEqual([])
  })
})

describe('searchActors', () => {
  it('asks the canonical endpoint, with no custom headers', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ actors: [{ did: 'did:plc:a', handle: 'alice.test' }] }))
    const controller = new AbortController()
    expect(await searchActors('ali', controller.signal, fetchImpl)).toEqual([{ did: 'did:plc:a', handle: 'alice.test' }])
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://typeahead.waow.tech/xrpc/tech.waow.typeahead.searchActors?q=ali&limit=${SUGGESTION_LIMIT}`)
    expect(init).toEqual({ signal: controller.signal })
  })

  it('fails on an error status, so nothing stale is shown', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"RateLimitExceeded"}', { status: 429 }))
    await expect(searchActors('ali', undefined, fetchImpl)).rejects.toThrow('HTTP 429')
  })
})

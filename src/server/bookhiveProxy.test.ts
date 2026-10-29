import { describe, expect, it, vi } from 'vitest'
import { GET, handle, METHODS, upstreamUrl } from '../../api/bookhive/[method].ts'

const base = 'https://papertrail.example/api/bookhive'

function upstream(body: unknown, init: ResponseInit = {}) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status: 200, ...init }))
}

describe('upstreamUrl', () => {
  it('maps an allowed method and its parameters onto bookhive.buzz', () => {
    expect(upstreamUrl(`${base}/searchBooks?q=dune&limit=5`)).toMatchObject({
      url: 'https://bookhive.buzz/xrpc/buzz.bookhive.searchBooks?q=dune&limit=5',
    })
    expect(upstreamUrl(`${base}/getLanguages`)).toMatchObject({
      url: 'https://bookhive.buzz/xrpc/buzz.bookhive.getLanguages',
    })
  })

  it("accepts Vercel's routed form, where the method arrives as a query parameter", () => {
    expect(upstreamUrl(`${base}/[method]?method=searchBooks&q=dune`)).toMatchObject({
      url: 'https://bookhive.buzz/xrpc/buzz.bookhive.searchBooks?q=dune',
    })
    expect(upstreamUrl(`${base}/searchBooks?q=dune&method=searchBooks`)).toMatchObject({
      url: 'https://bookhive.buzz/xrpc/buzz.bookhive.searchBooks?q=dune',
    })
    expect(upstreamUrl(`${base}/[method]?method=getPersonalLibrary`)).toMatchObject({ status: 404 })
  })

  it('refuses methods outside the allowlist, including authenticated and write ones', () => {
    for (const method of ['getPersonalLibrary', 'uploadPersonalBook', 'createList', 'getFeed', 'constructor', '__proto__']) {
      expect(upstreamUrl(`${base}/${method}`)).toMatchObject({ status: 404, error: 'MethodNotSupported' })
    }
  })

  it('refuses unknown, repeated and oversized parameters', () => {
    expect(upstreamUrl(`${base}/getBook?id=bk_1&cookie=x`)).toMatchObject({ status: 400 })
    expect(upstreamUrl(`${base}/getBook?id=bk_1&id=bk_2`)).toMatchObject({ status: 400 })
    expect(upstreamUrl(`${base}/searchBooks?q=${'a'.repeat(600)}`)).toMatchObject({ status: 400 })
  })

  it('never lets a parameter change the upstream host or path', () => {
    const target = upstreamUrl(`${base}/getBook?id=${encodeURIComponent('../../evil.example/x?y=')}`)
    expect('url' in target && new URL(target.url).host).toBe('bookhive.buzz')
    expect('url' in target && new URL(target.url).pathname).toBe('/xrpc/buzz.bookhive.getBook')
  })
})

describe('handle', () => {
  it('relays JSON with a CDN cache tuned to the method', async () => {
    const fetchImpl = upstream({ books: [{ id: 'bk_1', title: 'Dune' }] })
    const res = await handle(new Request(`${base}/searchBooks?q=dune`), fetchImpl)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ books: [{ id: 'bk_1', title: 'Dune' }] })
    expect(res.headers.get('cache-control')).toBe(
      `public, max-age=60, s-maxage=${METHODS.searchBooks!.ttl}, stale-while-revalidate=${METHODS.searchBooks!.ttl * 4}`,
    )
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
  })

  it('sends nothing from the visitor upstream: no cookies, no auth, just its own headers', async () => {
    const fetchImpl = upstream({})
    await handle(
      new Request(`${base}/getBook?id=bk_1`, { headers: { cookie: 'sid=secret', authorization: 'Bearer x' } }),
      fetchImpl,
    )
    const init = fetchImpl.mock.calls[0]![1]!
    const headers = new Headers(init.headers)
    expect(headers.get('cookie')).toBeNull()
    expect(headers.get('authorization')).toBeNull()
    expect(headers.get('user-agent')).toMatch(/^Papertrail/)
    expect(init.redirect).toBe('error')
  })

  it('passes XRPC errors through with a short cache', async () => {
    const fetchImpl = upstream({ error: 'NotFound', message: 'Book not found' }, { status: 404 })
    const res = await handle(new Request(`${base}/getBook?id=bk_missing`), fetchImpl)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'NotFound', message: 'Book not found' })
    expect(res.headers.get('cache-control')).toContain('s-maxage=300')
  })

  it('turns upstream failures into an uncached 502', async () => {
    const down = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed')
    })
    const broken = upstream({}, { status: 503 })
    const notJson = vi.fn<typeof fetch>(async () => new Response('<html>', { status: 200 }))
    for (const fetchImpl of [down, broken, notJson]) {
      const res = await handle(new Request(`${base}/getBook?id=bk_1`), fetchImpl)
      expect(res.status).toBe(502)
      expect(res.headers.get('cache-control')).toBe('no-store')
    }
  })

  it('refuses oversized answers', async () => {
    const huge = vi.fn<typeof fetch>(async () => new Response('x', { headers: { 'content-length': '9000000' } }))
    expect((await handle(new Request(`${base}/getBook?id=bk_1`), huge)).status).toBe(502)
  })

  it('refuses other HTTP methods and bad requests without calling BookHive', async () => {
    const fetchImpl = upstream({})
    expect((await handle(new Request(`${base}/getBook?id=1`, { method: 'POST' }), fetchImpl)).status).toBe(405)
    const bad = await handle(new Request(`${base}/createList`), fetchImpl)
    expect(bad.status).toBe(404)
    expect(bad.headers.get('cache-control')).toContain('s-maxage=60')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('is exported as the GET handler Vercel calls', () => {
    expect(typeof GET).toBe('function')
  })
})

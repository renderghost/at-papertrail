import { describe, expect, it, vi } from 'vitest'
import { cardFor, handle, renderCard } from '../../api/share.ts'

const BOOKHIVE_PDS = 'https://pds.bookhive.example'

function fakeFetch(routes: Record<string, unknown>) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input)
    const hit = Object.entries(routes).find(([prefix]) => url.startsWith(prefix))
    return hit ? new Response(JSON.stringify(hit[1]), { status: 200 }) : new Response('{}', { status: 404 })
  })
}

const plc = (pds: string) => ({ service: [{ id: '#atproto_pds', serviceEndpoint: pds }] })

describe('share cards', () => {
  it('describes a book from the catalogue, with its cover blob', async () => {
    const f = fakeFetch({
      'https://plc.directory/did:plc:enu2j5xjlqsjaylv3du4myh4': plc(BOOKHIVE_PDS),
      [`${BOOKHIVE_PDS}/xrpc/com.atproto.repo.getRecord`]: {
        value: { title: 'Piranesi', authors: 'Susanna Clarke', description: '<p>Piranesi has always lived in the House.</p>', coverBlob: { ref: { $link: 'bafycover' } } },
      },
    })
    const card = await cardFor(new URL('https://pt.example/api/share?kind=book&id=bk_abc123'), f)
    expect(card).toMatchObject({
      title: 'Piranesi by Susanna Clarke',
      description: 'Piranesi has always lived in the House.',
      path: '/books/bk_abc123',
      image: `${BOOKHIVE_PDS}/xrpc/com.atproto.sync.getBlob?did=did:plc:enu2j5xjlqsjaylv3du4myh4&cid=bafycover`,
    })
  })

  it('describes a reader from their Bluesky profile', async () => {
    const f = fakeFetch({
      'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile': { did: 'did:plc:a', handle: 'alice.test', displayName: 'Alice', avatar: 'https://cdn.example/a.jpg' },
    })
    expect(await cardFor(new URL('https://pt.example/api/share?kind=profile&actor=alice.test'), f)).toMatchObject({
      title: 'Alice on Papertrail',
      path: '/profile/alice.test',
      image: 'https://cdn.example/a.jpg',
    })
  })

  it('describes a list from its record', async () => {
    const f = fakeFetch({
      'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile': { did: 'did:plc:a', handle: 'alice.test' },
      'https://plc.directory/did:plc:a': plc('https://pds.alice.example'),
      'https://pds.alice.example/xrpc/com.atproto.repo.getRecord': { value: { name: 'Sci-fi to press on friends' } },
    })
    expect(await cardFor(new URL('https://pt.example/api/share?kind=shelf&actor=alice.test&rkey=3lz3ead6kek2v'), f)).toMatchObject({
      title: 'Sci-fi to press on friends · a list by @alice.test',
      path: '/shelves/alice.test/3lz3ead6kek2v',
    })
  })

  it('rejects malformed parameters without fetching anything', async () => {
    const f = fakeFetch({})
    for (const q of ['kind=book&id=../../x', 'kind=profile&actor=<script>', 'kind=shelf&actor=a.test&rkey=a/b', 'kind=nope']) {
      expect(await cardFor(new URL(`https://pt.example/api/share?${q}`), f)).toBeNull()
    }
    expect(f).not.toHaveBeenCalled()
  })

  it('escapes everything it puts in the page, and drops non-https images', () => {
    const html = renderCard(
      { title: '"><script>alert(1)</script>', description: "Tom's & Jerry's", path: '/books/bk_1', image: 'javascript:alert(1)', type: 'book' },
      'https://pt.example',
    )
    expect(html).not.toContain('<script>')
    expect(html).toContain('&quot;&gt;&lt;script&gt;')
    expect(html).toContain('Tom&#39;s &amp; Jerry&#39;s')
    expect(html).not.toContain('og:image')
    expect(html).toContain('<link rel="canonical" href="https://pt.example/books/bk_1">')
  })

  it('still answers with a generic card when lookups fail', async () => {
    const res = await handle(new Request('https://pt.example/api/share?kind=book&id=bk_missing'), fakeFetch({}))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
    expect(await res.text()).toContain('og:title" content="A book on Papertrail"')
  })
})

describe('author cards', () => {
  it("use the author's most popular cover", async () => {
    const f = fakeFetch({
      'https://bookhive.buzz/xrpc/buzz.bookhive.getAuthorBooks': { books: [{ title: 'Piranesi', cover: 'https://img.example/p.jpg' }], totalBooks: 14 },
    })
    expect(await cardFor(new URL('https://pt.example/api/share?kind=author&name=Susanna%20Clarke'), f)).toMatchObject({
      title: 'Susanna Clarke · books on Papertrail',
      image: 'https://img.example/p.jpg',
      path: '/authors/Susanna%20Clarke',
    })
  })
})

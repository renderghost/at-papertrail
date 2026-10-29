import { describe, expect, it } from 'vitest'
import { bylineLinks, findBylineAuthor, findBylineBook, plainText, type BylineAuthor, type BylineDirectory } from './byline'

const author = (did: string, extra: Partial<BylineAuthor> = {}): BylineAuthor => ({ did, pds: 'https://pds.example', profile: null, books: [], ...extra })
const book = (did: string, value: object) => ({
  uri: `at://${did}/pub.byline.book/3k1`,
  rkey: '3k1',
  did,
  pds: 'https://pds.example',
  value: { title: 'T', createdAt: '2026-01-01T00:00:00Z', ...value },
})

const dir: BylineDirectory = {
  loadedAt: 0,
  authors: [
    author('did:plc:a', {
      profile: { displayName: 'Ada Writer', penNames: ['A. W. Penn'], createdAt: '' },
      books: [book('did:plc:a', { title: 'Night Trains', identifiers: { hiveId: 'bk_night' } })],
    }),
    author('did:plc:b', {
      books: [book('did:plc:b', { title: 'Deep Water', authors: [{ name: 'Bea Ocean' }], editions: [{ format: 'paperback', isbn13: '9780593135204' }] })],
    }),
  ],
}

describe('byline', () => {
  it('finds a book by hiveId, else by any edition ISBN', () => {
    expect(findBylineBook(dir, { hiveId: 'bk_night' })?.book.value.title).toBe('Night Trains')
    expect(findBylineBook(dir, { hiveId: 'bk_other', identifiers: { isbn10: '0593135202' } })?.author.did).toBe('did:plc:b')
    expect(findBylineBook(dir, { hiveId: 'bk_none' })).toBeNull()
  })

  it('finds an author by display name, pen name or credited name, ignoring case and accents', () => {
    expect(findBylineAuthor(dir, 'ada writer')?.did).toBe('did:plc:a')
    expect(findBylineAuthor(dir, 'A.W. Penn')?.did).toBe('did:plc:a')
    expect(findBylineAuthor(dir, 'Béa Ocean')?.did).toBe('did:plc:b')
    expect(findBylineAuthor(dir, 'Nobody')).toBeNull()
  })

  it('shows Markdown as plain text', () => {
    expect(plainText('# Title\n\nA **bold** [link](https://x) and _soft_ words.\n- one')).toBe('Title\n\nA bold link and soft words.\n• one')
  })

  it("keeps https links only, the author's preferred first", () => {
    const links = bylineLinks([
      { url: 'https://shop.example', kind: 'retailer' },
      { url: 'javascript:alert(1)' },
      { url: 'https://author.example', kind: 'author', primary: true },
    ])
    expect(links.map((l) => l.url)).toEqual(['https://author.example', 'https://shop.example'])
  })
})

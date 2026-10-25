import { describe, expect, it } from 'vitest'
import { getHiveId } from './bookhive/hiveId'
import { STATUS, type CatalogBook } from './bookhive/types'
import {
  bookKey,
  fromGoogle,
  fromOpenLibrary,
  identityFromCandidate,
  mergeCandidates,
  newBookRecord,
  pickIsbns,
} from './search'

const NOW = '2025-06-01T12:00:00.000Z'

describe('pickIsbns', () => {
  it('finds a 13- and a 10-digit ISBN among mixed values', () => {
    expect(pickIsbns(['0-06-125178-X', '9780061251788', '1234'])).toEqual({
      isbn13: '9780061251788',
      isbn10: '006125178X',
    })
  })
})

describe('bookKey', () => {
  it('ignores case, accents, punctuation and a leading article', () => {
    expect(bookKey('The Left Hand of Darkness', 'Ursula K. Le Guin')).toBe(
      bookKey('left hand of darkness', 'Ursula K Le Guin'),
    )
    expect(bookKey('Les Misérables', 'Victor Hugo')).toBe(bookKey('Les Miserables', 'Victor Hugo'))
  })
})

describe('mergeCandidates', () => {
  const ol = fromOpenLibrary({
    key: '/works/OL1W',
    title: 'Piranesi',
    author_name: ['Susanna Clarke'],
    isbn: ['9781635575637'],
    cover_i: 1,
  })
  const gb = fromGoogle({
    id: 'g1',
    volumeInfo: {
      title: 'Piranesi',
      authors: ['Susanna Clarke'],
      description: 'Piranesi lives in the House.',
      pageCount: 272,
      industryIdentifiers: [{ type: 'ISBN_13', identifier: '9781526622433' }],
    },
  })!

  it('folds the same book from both sources into one result', () => {
    const merged = mergeCandidates([ol], [gb])
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      isbn13: '9781635575637',
      description: 'Piranesi lives in the House.',
      pages: 272,
      sources: ['openlibrary', 'google'],
    })
  })

  it('drops results without an author', () => {
    const anonymous = fromOpenLibrary({ key: '/works/OL2W', title: 'Untitled' })
    expect(mergeCandidates([anonymous], [])).toEqual([])
  })
})

describe('newBookRecord', () => {
  const candidate = fromOpenLibrary({
    key: '/works/OL3W',
    title: 'Bee Movie',
    subtitle: 'The Junior Novel',
    author_name: ['Susan Korman'],
    isbn: ['9780061251788'],
  })

  it("uses the catalogue's title, authors and identifiers when BookHive knows the book", () => {
    const catalog: CatalogBook = {
      id: 'bk_FEQcl1dxSUgnRbODU6cK',
      title: 'Bee Movie',
      authors: 'Susan Korman',
      thumbnail: 'https://example/thumb.jpg',
      identifiers: { goodreadsId: '1646160', isbn13: '9780061251788' },
    }
    const record = newBookRecord(identityFromCandidate(candidate, catalog.id), catalog, STATUS.finished, () => NOW)
    expect(record).toEqual({
      $type: 'buzz.bookhive.book',
      title: 'Bee Movie',
      authors: 'Susan Korman',
      hiveId: 'bk_FEQcl1dxSUgnRbODU6cK',
      createdAt: NOW,
      status: STATUS.finished,
      finishedAt: NOW,
      identifiers: {
        isbn13: '9780061251788',
        goodreadsId: '1646160',
        hiveId: 'bk_FEQcl1dxSUgnRbODU6cK',
      },
      hiveBookUri: 'at://did:plc:enu2j5xjlqsjaylv3du4myh4/buzz.bookhive.catalogBook/bk_FEQcl1dxSUgnRbODU6cK',
    })
  })

  it('falls back to the BookHive-style id and the full title when uncatalogued', () => {
    const hiveId = getHiveId({ title: 'Bee Movie: The Junior Novel', authors: 'Susan Korman' })
    const record = newBookRecord(identityFromCandidate(candidate, hiveId), null, STATUS.wantToRead, () => NOW)
    expect(record.title).toBe('Bee Movie: The Junior Novel')
    expect(record.hiveBookUri).toBeUndefined()
    expect(record.startedAt).toBeUndefined()
    expect(record.identifiers).toEqual({ hiveId, isbn13: '9780061251788' })
  })
})

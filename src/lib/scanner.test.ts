import { describe, expect, it, vi } from 'vitest'
import type { CatalogBook } from './bookhive/types'
import { bookCodes, lookupIsbn, type IsbnDeps } from './scanner'
import type { Candidate } from './search'

const DUNE: CatalogBook = { id: 'bk_dune', title: 'Dune', authors: 'Frank Herbert', thumbnail: 'https://img/dune.jpg', identifiers: { isbn10: '0441013597' } }

const deps = (over: Partial<IsbnDeps> = {}): IsbnDeps => ({
  hiveIdForIsbn: vi.fn(async () => null),
  catalogue: vi.fn(async () => null),
  search: vi.fn(async () => [] as Candidate[]),
  match: vi.fn(async () => ({ hiveId: 'bk_computed', catalog: null })),
  ...over,
})

describe('bookCodes', () => {
  it('keeps book barcodes only, once each', () => {
    expect(bookCodes(['9780441013593', ' 9780441013593 ', '5012345678900', '9780441013594'])).toEqual(['9780441013593'])
  })
})

describe('lookupIsbn', () => {
  it("uses BookHive's catalogue when it knows the ISBN, keeping the edition you hold", async () => {
    const d = deps({ hiveIdForIsbn: vi.fn(async () => 'bk_dune'), catalogue: vi.fn(async () => DUNE) })
    expect(await lookupIsbn('9780441013593', d)).toEqual({
      isbn: '9780441013593',
      hiveId: 'bk_dune',
      title: 'Dune',
      authors: 'Frank Herbert',
      identifiers: { isbn13: '9780441013593', isbn10: '0441013597' },
      catalog: DUNE,
      coverUrl: 'https://img/dune.jpg',
    })
    expect(d.search).not.toHaveBeenCalled()
  })

  it('falls back to Open Library and Google Books, with the hiveId BookHive would compute', async () => {
    const candidate: Candidate = { key: 'ol1', title: 'A Small Press Book', subtitle: 'Poems', authors: ['Jo Bloggs', 'Ann Other'], isbn13: '9781234567897', sources: ['openlibrary'] }
    const d = deps({ search: vi.fn(async () => [candidate]) })
    expect(await lookupIsbn('9781234567897', d)).toMatchObject({
      hiveId: 'bk_computed',
      title: 'A Small Press Book: Poems',
      authors: 'Jo Bloggs\tAnn Other',
      catalog: null,
    })
    expect(d.search).toHaveBeenCalledWith('isbn:9781234567897', undefined)
  })

  it('returns null when nobody knows the ISBN, and survives failures', async () => {
    const d = deps({ hiveIdForIsbn: vi.fn(async () => Promise.reject(new Error('down'))) })
    expect(await lookupIsbn('9781234567897', d)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { areaOf, currentness, MOVED, movedPath, normalisePath, tabOf } from './nav'

const where = (path: string) => {
  const area = areaOf(path)
  return [area?.label, area && tabOf(area, path)?.label]
}

describe('navigation', () => {
  it('puts every tab page in its area and on its tab', () => {
    expect(where('/')).toEqual(['Library', 'Overview'])
    expect(where('/library/books')).toEqual(['Library', 'Books'])
    expect(where('/library/manage')).toEqual(['Library', 'Manage'])
    expect(where('/friends')).toEqual(['Friends', 'Feed'])
    expect(where('/friends/ask-around')).toEqual(['Friends', 'Ask around'])
    expect(where('/discover')).toEqual(['Discover', 'Because you loved…'])
    expect(where('/discover/search')).toEqual(['Discover', 'Search'])
    expect(where('/covered')).toEqual(['Covered', undefined])
  })

  it('keeps a page under a tab on that tab, never on its area’s first', () => {
    expect(where('/library/manage/scan')).toEqual(['Library', 'Manage'])
    expect(where('/discover/browse/genres/Fantasy')).toEqual(['Discover', 'Browse all'])
    expect(where('/covered/2026')).toEqual(['Covered', undefined])
    expect(where('/friends/club/')).toEqual(['Friends', 'Book club'])
  })

  it('leaves book, author, profile and list pages out of every area', () => {
    for (const path of ['/books/bk_1', '/authors/Susanna%20Clarke', '/profile/alice.test', '/shelves/alice.test/3l1', '/switch', '/login', '/discovery']) {
      expect(areaOf(path)).toBeUndefined()
    }
  })

  it('marks the page itself as the page, and the area or tab it is under as current', () => {
    expect(currentness('/library/manage/scan', '/library/manage', true)).toBe('true')
    expect(currentness('/library/manage/', '/library/manage', true)).toBe('page')
    expect(currentness('/', '/', false)).toBeUndefined()
    expect(normalisePath('/')).toBe('/')
  })

  it('sends old addresses to their new pages, with anything under them', () => {
    const moved = (path: string) => movedPath(path, MOVED.find((m) => path === m.from || path.startsWith(`${m.from}/`))!)
    expect(moved('/feed')).toBe('/friends')
    expect(moved('/twins')).toBe('/friends/like-you')
    expect(moved('/want-to-read')).toBe('/friends/ask-around')
    expect(moved('/add')).toBe('/discover/search')
    expect(moved('/scan')).toBe('/library/manage/scan')
    expect(moved('/explore')).toBe('/discover/browse')
    expect(moved('/explore/genres/Science%20Fiction')).toBe('/discover/browse/genres/Science%20Fiction')
  })
})

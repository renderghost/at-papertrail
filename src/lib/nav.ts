import { PATHS } from './paths'

/**
 * Navigation (#104): two levels at most. The areas sit in the top bar (the
 * bottom bar on phones), and each area's features are its tabs. Anything
 * deeper, like Manage's tools or a genre, is content on its tab.
 */

export type NavTab = { to: string; label: string }
export type NavArea = { label: string; icon: 'library' | 'club' | 'compass' | 'covered'; to: string; tabs: NavTab[] }

export const AREAS: NavArea[] = [
  {
    label: 'Library',
    icon: 'library',
    to: PATHS.overview,
    tabs: [
      { to: PATHS.overview, label: 'Overview' },
      { to: PATHS.books, label: 'Books' },
      { to: PATHS.lists, label: 'Lists' },
      { to: PATHS.manage, label: 'Manage' },
    ],
  },
  {
    label: 'Friends',
    icon: 'club',
    to: PATHS.feed,
    tabs: [
      { to: PATHS.feed, label: 'Feed' },
      { to: PATHS.club, label: 'Book club' },
      { to: PATHS.likeYou, label: 'Like you' },
      { to: PATHS.askAround, label: 'Ask around' },
    ],
  },
  {
    label: 'Discover',
    icon: 'compass',
    to: PATHS.becauseYouLoved,
    tabs: [
      { to: PATHS.becauseYouLoved, label: 'Because you loved…' },
      { to: PATHS.nextRead, label: 'Pick my next read' },
      { to: PATHS.series, label: 'Continue a series' },
      { to: PATHS.recommendations, label: 'Recommendations' },
      { to: PATHS.browse, label: 'Browse all' },
      { to: PATHS.search, label: 'Search' },
    ],
  },
  { label: 'Covered', icon: 'covered', to: PATHS.covered, tabs: [] },
]

/** "/friends/" and "/friends" are the same page. */
export function normalisePath(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/'
}

/** Whether `path` is `to` or a page under it; "/" is only itself. */
function within(path: string, to: string): boolean {
  return path === to || (to !== '/' && path.startsWith(`${to}/`))
}

/** The area a page is in. Book, author, profile and list pages are in none. */
export function areaOf(pathname: string): NavArea | undefined {
  const path = normalisePath(pathname)
  return AREAS.find((a) => within(path, a.to) || a.tabs.some((t) => within(path, t.to)))
}

/** The tab a page is on: the deepest it's within, so a genre is on Browse all and Scan is on Manage. */
export function tabOf(area: NavArea, pathname: string): NavTab | undefined {
  const path = normalisePath(pathname)
  return area.tabs.filter((t) => within(path, t.to)).sort((a, b) => b.to.length - a.to.length)[0]
}

/** aria-current for an area or tab link: "page" on its own page, "true" on a page under it. */
export function currentness(pathname: string, to: string, on: boolean): 'page' | 'true' | undefined {
  if (!on) return undefined
  return normalisePath(pathname) === to ? 'page' : 'true'
}

/** Addresses from before #104, and where their pages are now. Each redirects, keeping its query. */
export const MOVED: { from: string; to: string }[] = [
  { from: '/feed', to: PATHS.feed },
  { from: '/club', to: PATHS.club },
  { from: '/twins', to: PATHS.likeYou },
  { from: '/want-to-read', to: PATHS.askAround },
  { from: '/add', to: PATHS.search },
  { from: '/scan', to: PATHS.scan },
  { from: '/import', to: PATHS.import },
  { from: '/export', to: PATHS.export },
  { from: '/fix', to: PATHS.fix },
  { from: '/explore', to: PATHS.browse },
]

/** An old address's new one: "/explore/genres/Fantasy" is now "/discover/browse/genres/Fantasy". */
export function movedPath(pathname: string, { from, to }: { from: string; to: string }): string {
  const path = normalisePath(pathname)
  return within(path, from) ? to + path.slice(from.length) : path
}

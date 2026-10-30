/**
 * Public URLs, shaped like bookhive.buzz's so a BookHive link becomes a
 * Papertrail link by swapping the domain.
 */

export function bookPath(hiveId: string): string {
  return `/books/${hiveId}`
}

export function profilePath(handleOrDid: string): string {
  return `/profile/${handleOrDid}`
}

/** "/login?next=/books/bk_1" for a sign-in that should come back here. */
export function loginPath(next?: string): string {
  return next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login'
}

/** An in-app path to return to after sign-in, or null if `value` isn't one. */
export function safeNext(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null
  return value
}

/** "/authors/Susanna%20Clarke", as on bookhive.buzz. */
export function authorPath(name: string): string {
  return `/authors/${encodeURIComponent(name)}`
}

/** A series, under its author: there's no series id to key it by. */
export function seriesPath(author: string, title: string): string {
  return `${authorPath(author)}/series/${encodeURIComponent(title)}`
}

/** A reader's lists. */
export function shelvesPath(handleOrDid: string): string {
  return `/shelves/${handleOrDid}`
}

/** One list: /shelves/:handle/:rkey, as on bookhive.buzz. */
export function shelfPath(handleOrDid: string, rkey: string): string {
  return `/shelves/${handleOrDid}/${rkey}`
}

/**
 * The app's own pages (#104): two levels at most, an area then its tabs.
 * Library's Overview is the home page.
 */
export const PATHS = {
  overview: '/',
  books: '/library/books',
  lists: '/library/lists',
  manage: '/library/manage',
  scan: '/library/manage/scan',
  import: '/library/manage/import',
  export: '/library/manage/export',
  fix: '/library/manage/fix',
  feed: '/friends',
  club: '/friends/club',
  likeYou: '/friends/like-you',
  askAround: '/friends/ask-around',
  becauseYouLoved: '/discover',
  nextRead: '/discover/next-read',
  series: '/discover/series',
  recommendations: '/discover/recommendations',
  browse: '/discover/browse',
  search: '/discover/search',
  covered: '/covered',
  switch: '/switch',
} as const

/** Discover › Search, with what to search for: "/discover/search?q=dune". */
export function searchPath(q?: string): string {
  const query = q?.trim()
  return query ? `${PATHS.search}?q=${encodeURIComponent(query)}` : PATHS.search
}

/** A genre under Browse all, in a language ("" for every language). */
export function genrePath(genre: string, language?: string): string {
  return `${PATHS.browse}/genres/${encodeURIComponent(genre)}${language !== undefined ? `?language=${encodeURIComponent(language)}` : ''}`
}

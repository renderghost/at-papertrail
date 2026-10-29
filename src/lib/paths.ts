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

/** A reader's lists. */
export function shelvesPath(handleOrDid: string): string {
  return `/shelves/${handleOrDid}`
}

/** One list: /shelves/:handle/:rkey, as on bookhive.buzz. */
export function shelfPath(handleOrDid: string, rkey: string): string {
  return `/shelves/${handleOrDid}/${rkey}`
}

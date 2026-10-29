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

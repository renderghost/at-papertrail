/**
 * OAuth client configuration, shared by the app and by the Vite build (which
 * emits `client-metadata.json`). Keep this file free of browser APIs.
 */

// Explicit extensions: vite.config.ts loads this file outside the bundler.
import { BOOK_COLLECTION } from './bookhive/types.ts'
import { normaliseSiteUrl } from './siteUrl.ts'

export const APP_NAME = 'Papertrail'

/** Collections Papertrail writes, each behind its own scope. Everything it reads is public. */
export const WRITE_SCOPES = {
  /** Your books: status, dates, progress, ratings, reviews. */
  books: `repo:${BOOK_COLLECTION}`,
  /** Lists and shelves, in PopFeed's format (as BookHive writes them). */
  lists: 'repo:social.popfeed.feed.list',
  listItems: 'repo:social.popfeed.feed.listItem',
  /** Your PopFeed profile record, for favourite books. */
  profile: 'repo:social.popfeed.actor.profile',
  /** Following readers and authors: create and delete only, as BookHive asks. */
  follows: 'repo:app.bsky.graph.follow?action=create&action=delete',
} as const

/** `atproto` is mandatory; the rest grant writes to exactly the collections above. */
export const OAUTH_SCOPE = ['atproto', ...Object.values(WRITE_SCOPES)].join(' ')

/** The OAuth client document for a deployed site URL (origin plus base path, ending in "/"). */
export function clientMetadata(siteUrl: string) {
  const site = normaliseSiteUrl(siteUrl)
  return {
    client_id: `${site}client-metadata.json`,
    client_name: APP_NAME,
    client_uri: site,
    logo_uri: `${site}favicon.svg`,
    redirect_uris: [site],
    scope: OAUTH_SCOPE,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'web',
    dpop_bound_access_tokens: true,
  } as const
}

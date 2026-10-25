/**
 * OAuth client configuration, shared by the app and by the Vite build (which
 * emits `client-metadata.json`). Keep this file free of browser APIs.
 */

// Explicit extension: vite.config.ts loads this file outside the bundler.
import { BOOK_COLLECTION } from './bookhive/types.ts'

export const APP_NAME = 'Papertrail'

/**
 * `atproto` is mandatory; `repo:buzz.bookhive.book` grants create/update/delete
 * on BookHive book records, the only collection this app writes, and nothing
 * else. Everything the app reads is public.
 */
export const OAUTH_SCOPE = `atproto repo:${BOOK_COLLECTION}`

export function normaliseSiteUrl(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}

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

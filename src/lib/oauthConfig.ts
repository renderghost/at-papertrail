/**
 * OAuth client configuration, shared by the app and by the Vite build (which
 * emits `client-metadata.json`). Keep this file free of browser APIs.
 */

import { BOOK_COLLECTION } from './bookhive/types'

export const APP_NAME = 'Papertrail'

/**
 * `atproto` is mandatory; `repo:buzz.bookhive.book` grants create/update/delete
 * on BookHive book records, the only collection this app writes, and nothing
 * else. Everything the app reads is public.
 */
export const OAUTH_SCOPE = `atproto repo:${BOOK_COLLECTION}`

/** Where the production build is served from. Must end with a slash. */
export const DEFAULT_SITE_URL = 'https://renderghost.github.io/at-papertrail/'

export function normaliseSiteUrl(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}

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

/**
 * The atproto loopback client used during local development: no metadata file
 * is needed, but the redirect must go to 127.0.0.1 rather than localhost.
 */
export function loopbackClientId(location: { port: string; pathname: string }): string {
  const redirectUri = `http://127.0.0.1${location.port ? `:${location.port}` : ''}${location.pathname}`
  const params = new URLSearchParams({ redirect_uri: redirectUri, scope: OAUTH_SCOPE })
  return `http://localhost?${params.toString()}`
}

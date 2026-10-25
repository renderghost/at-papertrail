/**
 * The public URL a build is served from: origin plus base path, ending in "/".
 *
 * Every deployment must describe itself, because a PDS only accepts a sign-in
 * when it can fetch `client-metadata.json` at exactly the URL that document
 * names as its `client_id`. Used by vite.config.ts at build time, so keep it
 * free of browser APIs.
 */

export type SiteEnv = {
  /** Explicit override: pins production, or configures a host other than Vercel. */
  VITE_SITE_URL?: string
  /** Vercel system variables, exposed to builds by default. */
  VERCEL_ENV?: string
  VERCEL_URL?: string
  VERCEL_PROJECT_PRODUCTION_URL?: string
}

export type ResolvedSiteUrl = {
  url: string
  /** Where the value came from, for build logs. */
  source: 'VITE_SITE_URL' | 'VERCEL_PROJECT_PRODUCTION_URL' | 'VERCEL_URL'
}

export function normaliseSiteUrl(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}

function https(host: string): string {
  return normaliseSiteUrl(`https://${host.replace(/^https?:\/\//, '')}`)
}

function validated(url: string, source: ResolvedSiteUrl['source']): ResolvedSiteUrl {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`${source} is not a valid URL: ${JSON.stringify(url)}`)
  }
  // atproto OAuth client ids must be https (only the loopback client is http, and needs no metadata).
  if (parsed.protocol !== 'https:') throw new Error(`${source} must be an https URL, got ${url}`)
  if (parsed.search || parsed.hash) throw new Error(`${source} must not have a query or fragment: ${url}`)
  return { url: normaliseSiteUrl(parsed.href), source }
}

/**
 * - Vercel preview: the deployment's own URL, always. A preview must never
 *   claim to be production, even when VITE_SITE_URL is set for every environment.
 * - Otherwise an explicit VITE_SITE_URL wins.
 * - Vercel production: the project's production domain (the shortest custom
 *   domain once one is added, else its vercel.app domain).
 * - Anything else (local builds, `vercel dev`): null.
 */
export function resolveSiteUrl(env: SiteEnv): ResolvedSiteUrl | null {
  if (env.VERCEL_ENV === 'preview' && env.VERCEL_URL) return validated(https(env.VERCEL_URL), 'VERCEL_URL')
  const explicit = env.VITE_SITE_URL?.trim()
  if (explicit) return validated(explicit, 'VITE_SITE_URL')
  if (env.VERCEL_ENV === 'production' && env.VERCEL_PROJECT_PRODUCTION_URL) {
    return validated(https(env.VERCEL_PROJECT_PRODUCTION_URL), 'VERCEL_PROJECT_PRODUCTION_URL')
  }
  return null
}

/**
 * When the page isn't served from the URL its build describes, OAuth can't
 * work there: the PDS would fetch metadata naming a different client. Returns
 * an explanation, or null when sign-in can proceed. Loopback origins use
 * atproto's loopback client and are always fine.
 */
export function originMismatch(origin: string, siteUrl: string): string | null {
  if (!siteUrl) return null
  if (/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return null
  const site = new URL(siteUrl)
  if (site.origin === origin) return null
  return `Sign-in works at ${site.href} — you're on ${new URL(origin).host}, which can't sign you in.`
}

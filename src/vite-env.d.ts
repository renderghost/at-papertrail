/// <reference types="vite/client" />

/**
 * The URL this build's OAuth client metadata describes (see src/lib/siteUrl.ts),
 * or "" for local builds. Injected by vite.config.ts.
 */
declare const __SITE_URL__: string

interface ImportMetaEnv {
  /** Explicit site URL; optional on Vercel, which provides its own. See .env.example. */
  readonly VITE_SITE_URL?: string
  /** Optional Google Books API key; search works without one at a lower quota. */
  readonly VITE_GOOGLE_BOOKS_API_KEY?: string
}

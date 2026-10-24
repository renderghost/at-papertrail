/// <reference types="vite/client" />

/** The production site URL, injected by vite.config.ts. Ends with a slash. */
declare const __SITE_URL__: string

interface ImportMetaEnv {
  /** Optional Google Books API key; search works without one at a lower quota. */
  readonly VITE_GOOGLE_BOOKS_API_KEY?: string
}

/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public URL of the deployed site; see .env. */
  readonly VITE_SITE_URL?: string
  /** Optional Google Books API key; search works without one at a lower quota. */
  readonly VITE_GOOGLE_BOOKS_API_KEY?: string
}

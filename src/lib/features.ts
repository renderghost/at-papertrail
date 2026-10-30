/**
 * Features switched off for now. Their code stays, typechecked and tested, so
 * each one comes back by flipping a single value.
 */
export const FEATURES = {
  /**
   * Byline's author-verified details: the book-page panel, author profiles and
   * the claim prompt, and forthcoming books in series (#46). Off since 30 Oct
   * 2026; #94 is restoring it. While off, nothing is fetched from Byline.
   */
  byline: false,
} as const

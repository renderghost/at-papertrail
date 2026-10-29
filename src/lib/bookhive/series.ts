/** A catalogue book's series, which BookHive stores as a JSON string. */
export type Series = { title: string; position?: string; url?: string }

export function parseSeries(raw: string | undefined): Series | null {
  if (!raw) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    // Older records may hold a bare series name.
    return raw.trim() && !raw.trim().startsWith('{') ? { title: raw.trim() } : null
  }
  const v = value as { title?: unknown; position?: unknown; webUrl?: unknown } | null
  if (!v || typeof v.title !== 'string' || !v.title.trim()) return null
  const position = typeof v.position === 'string' && v.position.trim() ? v.position.trim() : undefined
  const url = typeof v.webUrl === 'string' && v.webUrl.startsWith('https://') ? v.webUrl : undefined
  return { title: v.title.trim(), ...(position ? { position } : {}), ...(url ? { url } : {}) }
}

/** "Book 2 of The Green Mile", or "Part of B.P.R.D." without a position. */
export function describeSeries(series: Series): string {
  return series.position ? `Book ${series.position} of ${series.title}` : `Part of ${series.title}`
}

/** Shares of each star rating (1 to 5), from a catalogue `ratingsDistribution` of counts. */
export function ratingShares(distribution: unknown): { stars: number; count: number; share: number }[] | null {
  if (!Array.isArray(distribution) || distribution.length !== 5) return null
  const counts = distribution.map((n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0))
  const total = counts.reduce((a, b) => a + b, 0)
  if (total === 0) return null
  return counts.map((count, i) => ({ stars: i + 1, count, share: count / total }))
}

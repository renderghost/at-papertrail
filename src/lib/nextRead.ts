import { parseSeries } from './bookhive/series'
import type { BookEntry, CatalogBook } from './bookhive/types'
import { seriesOrder } from './bibliography'
import { plural } from './format'

/**
 * Pick my next read (#74): the right book from your want-to-read list for
 * the moment, by length, genre and whether it stands alone. Every pick says
 * why. Lengths use an average reading speed until pacing (#51) learns yours.
 */

export const PAGES_PER_HOUR = 45
const DEFAULT_PAGES_PER_DAY = 30

export type Occasion = {
  id: string
  label: string
  blurb: string
  /** Hours you have, read at PAGES_PER_HOUR. */
  hours?: [number, number]
  pages?: [number, number]
  prefer?: string[]
  avoid?: string[]
  standalone?: boolean
  /** A set of books for this many days, at your pace. */
  days?: number
}

export const OCCASIONS: Occasion[] = [
  {
    id: 'flight',
    label: 'Long flight',
    blurb: '6–12 hours: a gripping standalone you can finish in the air',
    hours: [6, 12],
    prefer: ['Thriller', 'Mystery', 'Suspense', 'Science Fiction', 'Fantasy', 'Adventure', 'Crime'],
    standalone: true,
  },
  { id: 'train', label: 'Long train ride', blurb: '2–5 hours: a novella or a short, absorbing read', hours: [2, 5] },
  {
    id: 'beach',
    label: 'Day at the beach',
    blurb: 'Light, fun, easy to dip in and out of',
    pages: [150, 400],
    prefer: ['Romance', 'Humor', 'Comedy', 'Contemporary', 'Chick Lit', 'Cozy Mystery', 'Mystery', 'Romantic Comedy'],
    avoid: ['Philosophy', 'History', 'Horror', 'War'],
  },
  { id: 'holiday', label: 'Two-week holiday', blurb: '2–4 books of different lengths and moods, or one doorstop', days: 14 },
  {
    id: 'commute',
    label: 'Commute',
    blurb: 'Short chapters, essays, short stories',
    pages: [60, 260],
    prefer: ['Short Stories', 'Essays', 'Poetry', 'Anthologies', 'Nonfiction', 'Memoir'],
  },
  {
    id: 'sunday',
    label: 'Rainy Sunday',
    blurb: 'Cosy and immersive, 300–400 pages',
    pages: [300, 400],
    prefer: ['Fantasy', 'Historical Fiction', 'Cozy Mystery', 'Mystery', 'Literary Fiction', 'Magical Realism'],
  },
  {
    id: 'bed',
    label: 'Before bed',
    blurb: 'Calm, not too tense',
    prefer: ['Literary Fiction', 'Contemporary', 'Poetry', 'Essays', 'Nature', 'Cozy Mystery'],
    avoid: ['Thriller', 'Horror', 'Suspense', 'Crime', 'True Crime', 'Psychological Thriller'],
  },
]

export type Candidate = {
  entry: BookEntry
  catalog: CatalogBook | null
  /** Stars (0.5–5) from the people you follow who've read it, if any. */
  networkAverage?: number | null
}

export type NextPick = { candidate: Candidate; score: number; why: string[] }

const lower = (xs: string[] | undefined) => new Set((xs ?? []).map((x) => x.trim().toLowerCase()))

/** Your pace in pages a day while reading, from finished books with dates and page counts (median). */
export function pagesPerDay(finished: { entry: BookEntry; pages?: number }[]): number {
  const paces = finished
    .flatMap(({ entry, pages }) => {
      const { startedAt, finishedAt } = entry.value
      if (!pages || !startedAt || !finishedAt) return []
      const days = (Date.parse(finishedAt) - Date.parse(startedAt)) / 86_400_000
      return days >= 1 ? [pages / days] : []
    })
    .sort((a, b) => a - b)
  return paces.length ? Math.round(paces[Math.floor(paces.length / 2)]!) : DEFAULT_PAGES_PER_DAY
}

function hoursText(pages: number): string {
  const hours = pages / PAGES_PER_HOUR
  return hours < 1.5 ? 'about an hour' : `about ${Math.round(hours)} hours`
}

/** How well a book suits an occasion, and why, as short phrases. */
export function scoreFor(c: Candidate, occasion: Occasion, { ownedFirst = false } = {}): NextPick {
  const why: string[] = []
  let score = 0
  const pages = c.catalog?.numPages
  const range = occasion.pages ?? (occasion.hours ? [occasion.hours[0] * PAGES_PER_HOUR, occasion.hours[1] * PAGES_PER_HOUR] : undefined)
  if (range) {
    if (!pages) score += 0.2
    else if (pages >= range[0] && pages <= range[1]) {
      score += 1
      why.push(occasion.hours ? `${pages} pages, ${hoursText(pages)}` : `${pages} pages`)
    } else {
      const off = pages < range[0] ? range[0] - pages : pages - range[1]
      score += Math.max(-0.5, 1 - off / ((range[1] - range[0]) / 2 + 50))
    }
  }
  const genres = c.catalog?.genres ?? []
  const prefer = lower(occasion.prefer)
  const avoid = lower(occasion.avoid)
  const liked = genres.filter((g) => prefer.has(g.trim().toLowerCase()))
  if (liked.length) {
    score += Math.min(1, 0.5 * liked.length)
    why.push(liked.slice(0, 2).join(' and ').toLowerCase())
  }
  if (genres.some((g) => avoid.has(g.trim().toLowerCase()))) score -= 1.5
  if (occasion.standalone) {
    const series = parseSeries(c.catalog?.series)
    if (!series) {
      score += 0.4
      why.push('a standalone')
    } else if (seriesOrder(series.position) !== 1) score -= 0.6
  }
  if (c.entry.value.owned) {
    score += ownedFirst ? 1 : 0.1
    why.push('you own it')
  }
  if (c.networkAverage) {
    score += Math.max(-0.5, (c.networkAverage - 3) / 2)
    if (c.networkAverage >= 4) why.push(`your network gives it ${c.networkAverage.toFixed(1)} stars`)
  }
  if (c.catalog?.rating) score += (c.catalog.rating / 1000 - 3.5) / 2
  return { candidate: c, score, why }
}

/** The best few for an occasion. A holiday is a set that fits the days at your pace. */
export function pickFor(candidates: Candidate[], occasion: Occasion, { ownedFirst = false, pace = DEFAULT_PAGES_PER_DAY, count = 3 } = {}): { picks: NextPick[]; note?: string } {
  const ranked = candidates.map((c) => scoreFor(c, occasion, { ownedFirst })).sort((a, b) => b.score - a.score)
  if (!occasion.days) return { picks: ranked.slice(0, count) }
  const budget = occasion.days * pace
  const picks: NextPick[] = []
  let total = 0
  for (const p of ranked) {
    const pages = p.candidate.catalog?.numPages ?? 300
    if (total + pages > budget * 1.15 || picks.length >= 4) continue
    picks.push(p)
    total += pages
  }
  return { picks, note: `${plural(picks.length, 'book')}, about ${total.toLocaleString('en-GB')} pages: two weeks at your pace of ${pace} pages a day` }
}

/** One random book, likelier the better your network and the catalogue rate it. */
export function surprise(candidates: Candidate[], random: () => number = Math.random): Candidate | null {
  if (!candidates.length) return null
  const weights = candidates.map((c) => Math.max(0.2, (c.networkAverage ?? (c.catalog?.rating ? c.catalog.rating / 1000 : 3.5)) - 2.5))
  let r = random() * weights.reduce((a, b) => a + b, 0)
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i]!
    if (r <= 0) return candidates[i]!
  }
  return candidates[candidates.length - 1]!
}

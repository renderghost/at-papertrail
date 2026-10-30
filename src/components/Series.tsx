import { useQueries, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getAuthorBooks, type HiveBook } from '../lib/bookhive/api'
import { fetchCatalogBook } from '../lib/bookhive/catalog'
import { STATUS, type BookEntry, type CatalogBook } from '../lib/bookhive/types'
import { useMyLibrary } from '../lib/hooks'
import { bookPath, seriesPath } from '../lib/paths'
import { findInSeries, hasRead, seriesOf, seriesOrder, seriesProgress, type SeriesBook } from '../lib/series'
import { useAuthorSeries } from '../lib/usePeople'
import { BookCard, CardGrid } from './Cards'
import { QuickAdd } from './QuickAdd'

const HOUR = 60 * 60 * 1000

/** "Book 3", "Book 1.5", or nothing for an unnumbered one. */
export function positionLabel(position: string | undefined): string {
  return position ? `Book ${position}` : ''
}

export const quickBook = (b: HiveBook) => ({ hiveId: b.id, title: b.title, authors: b.authors, identifiers: b.identifiers, catalog: b })

/**
 * A book's place in its series, on its page (#61): the books around it with
 * your status, and "next in the series" the moment you finish it.
 */
export function SeriesSection({ book, mine }: { book: CatalogBook | null; mine: BookEntry | undefined }) {
  const series = seriesOf(book)
  const authorBooks = useAuthorSeries(series?.author)
  const library = useMyLibrary()
  const title = series?.title
  const progress = useMemo(
    () => (title && authorBooks.data ? seriesProgress(authorBooks.data, title, library.data ?? []) : null),
    [title, authorBooks.data, library.data],
  )

  // Marking this book finished here is the moment to offer the next one.
  const status = mine?.value.status
  const before = useRef(status)
  const [justFinished, setJustFinished] = useState(false)
  useEffect(() => {
    if (before.current && before.current !== STATUS.finished && status === STATUS.finished) setJustFinished(true)
    before.current = status
  }, [status])

  if (!series || !progress || progress.books.length < 2) return null
  const here = progress.books.findIndex((b) => b.book.id === book!.id)
  const start = Math.max(0, here - 2)
  const shown = progress.books.slice(start, Math.max(start + 6, here + 4))
  // After this book: the next main book you haven't read.
  const after = progress.books.find((b) => b.main && b.order > (progress.books[here]?.order ?? -Infinity) && !hasRead(b.entry))

  return (
    <section className="section">
      <div className="section-title">
        <h2>{series.title}</h2>
        <Link className="btn btn-quiet btn-sm" to={seriesPath(series.author, series.title)}>
          All {progress.books.length} books
        </Link>
      </div>
      {justFinished && after && !after.entry && (
        <div className="notice notice-ok next-up" role="status">
          <p>
            <strong>Next in {series.title}:</strong> <Link to={bookPath(after.book.id)}>{after.book.title}</Link>
            {after.position ? ` (book ${after.position})` : ''}
          </p>
          <QuickAdd book={quickBook(after.book)} />
        </div>
      )}
      <CardGrid size="compact" className="series-strip" label={`${series.title}, in order`}>
        {shown.map((b) => (
          <SeriesItem key={b.book.id} item={b} current={b.book.id === book!.id} next={b === after} />
        ))}
      </CardGrid>
    </section>
  )
}

function SeriesItem({ item, current, next }: { item: SeriesBook; current: boolean; next: boolean }) {
  return (
    <BookCard
      size="compact"
      book={{ ...quickBook(item.book), entry: item.entry }}
      context={
        <p>
          {current ? 'This book' : positionLabel(item.position) || 'Unnumbered'}
          {current && item.position ? ` · ${positionLabel(item.position).toLowerCase()}` : ''}
          {next ? ' · next' : ''}
        </p>
      }
      action={current ? null : undefined}
    />
  )
}

/**
 * "Continue a series" on your library (#61): the next unread book in each
 * series you've finished something from, most recent first.
 */
export function ContinueSeries({ entries }: { entries: BookEntry[] }) {
  const finished = useMemo(
    () =>
      entries
        .filter(hasRead)
        .sort((a, b) => (b.value.finishedAt ?? '').localeCompare(a.value.finishedAt ?? ''))
        .slice(0, 40),
    [entries],
  )
  const catalogs = useQueries({
    queries: finished.map((e) => ({
      queryKey: ['catalog', e.value.hiveId],
      queryFn: () => fetchCatalogBook(e.value.hiveId),
      staleTime: 6 * HOUR,
      gcTime: 6 * HOUR,
    })),
  })
  // Each series you've read in, and the furthest whole-numbered book of it you've read.
  const series = useMemo(() => {
    const seen = new Map<string, { title: string; author: string; furthest: number }>()
    for (const q of catalogs) {
      const s = seriesOf(q.data)
      const order = seriesOrder(s?.position)
      if (!s || !Number.isInteger(order)) continue
      const key = `${s.author}|${s.title}`.toLowerCase()
      seen.set(key, { title: s.title, author: s.author, furthest: Math.max(order, seen.get(key)?.furthest ?? 0) })
    }
    return [...seen.values()].slice(0, 8)
  }, [catalogs])
  // Only as much of each author's list as it takes to find the next book.
  const queryClient = useQueryClient()
  const found = useQueries({
    queries: series.map((s) => ({
      queryKey: ['series-find', s.author, s.title.toLowerCase(), s.furthest + 1],
      queryFn: async () => {
        const listing = await queryClient.fetchQuery({
          queryKey: ['author-books', s.author],
          queryFn: ({ signal }) => getAuthorBooks(s.author, signal),
          staleTime: 6 * HOUR,
        })
        return findInSeries(listing.books, s.title, s.furthest + 1)
      },
      staleTime: 6 * HOUR,
      retry: false,
    })),
  })
  const items = series.flatMap((s, i) => {
    const editions = found[i]?.data
    const next = editions?.length ? seriesProgress(editions, s.title, entries).books[0] : undefined
    // Skip what you're reading, gave up on, or read in another edition.
    const status = next?.entry?.value.status
    if (!next || hasRead(next.entry) || status === STATUS.reading || status === STATUS.abandoned) return []
    return [{ series: s, next }]
  })

  if (!items.length) return null
  return (
    <section className="section">
      <div className="section-title">
        <h2>Continue a series</h2>
        <span className="count">{items.length}</span>
      </div>
      <CardGrid size="large" className="continue-series" label="Continue a series">
        {items.map(({ series: s, next }) => (
          <BookCard
            key={`${s.author}|${s.title}`}
            book={{ ...quickBook(next.book), entry: next.entry }}
            context={
              <Link to={seriesPath(s.author, s.title)}>
                {next.position ? `Book ${next.position} of ` : ''}
                {s.title}
              </Link>
            }
          />
        ))}
      </CardGrid>
    </section>
  )
}

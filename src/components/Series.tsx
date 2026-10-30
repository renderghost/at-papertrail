import { useQueries } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getAuthorBooks, type HiveBook } from '../lib/bookhive/api'
import { fetchCatalogBook } from '../lib/bookhive/catalog'
import { STATUS, type BookEntry, type CatalogBook } from '../lib/bookhive/types'
import { useMyLibrary } from '../lib/hooks'
import { bookPath, seriesPath } from '../lib/paths'
import { hasRead, seriesOf, seriesProgress, type SeriesBook } from '../lib/series'
import { useAuthorBooks } from '../lib/usePeople'
import { StatusPill } from './bits'
import { Cover } from './Cover'
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
  const authorBooks = useAuthorBooks(series?.author)
  const library = useMyLibrary()
  const title = series?.title
  const progress = useMemo(
    () => (title && authorBooks.data ? seriesProgress(authorBooks.data.books, title, library.data ?? []) : null),
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
      <ol className="series-strip">
        {shown.map((b) => (
          <SeriesItem key={b.book.id} item={b} current={b.book.id === book!.id} next={b === after} />
        ))}
      </ol>
    </section>
  )
}

function SeriesItem({ item, current, next }: { item: SeriesBook; current: boolean; next: boolean }) {
  return (
    <li className={current ? 'current' : undefined} aria-current={current ? 'page' : undefined}>
      <Link to={bookPath(item.book.id)} tabIndex={-1} aria-hidden="true">
        <Cover hiveId={item.book.id} title={item.book.title} authors={item.book.authors} fallbackUrl={item.book.cover || item.book.thumbnail} size="sm" />
      </Link>
      <span className="small muted">
        {positionLabel(item.position)}
        {next ? ' · next' : ''}
      </span>
      <Link className="name" to={bookPath(item.book.id)}>
        {item.book.title}
      </Link>
      {item.entry && <StatusPill status={item.entry.value.status} />}
    </li>
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
  const series = useMemo(() => {
    const seen = new Map<string, { title: string; author: string }>()
    for (const q of catalogs) {
      const s = seriesOf(q.data)
      if (s) seen.set(`${s.author}|${s.title}`.toLowerCase(), s)
    }
    return [...seen.values()].slice(0, 16)
  }, [catalogs])
  const authors = [...new Set(series.map((s) => s.author))].slice(0, 12)
  const authorBooks = useQueries({
    queries: authors.map((a) => ({
      queryKey: ['author-books', a],
      queryFn: ({ signal }: { signal: AbortSignal }) => getAuthorBooks(a, signal),
      staleTime: 6 * HOUR,
      retry: false,
    })),
  })
  const byAuthor = new Map(authors.map((a, i) => [a, authorBooks[i]?.data?.books]))
  const items = series.flatMap((s) => {
    const books = byAuthor.get(s.author)
    if (!books) return []
    const { next, read } = seriesProgress(books, s.title, entries)
    // Skip what you're already reading, and series you haven't really started.
    if (!next || !read || next.entry?.value.status === STATUS.reading || next.entry?.value.status === STATUS.abandoned) return []
    return [{ series: s, next }]
  })

  if (!items.length) return null
  return (
    <section className="section">
      <div className="section-title">
        <h2>Continue a series</h2>
        <span className="count">{items.length}</span>
      </div>
      <ul className="continue-series">
        {items.map(({ series: s, next }) => (
          <li key={`${s.author}|${s.title}`}>
            <Link to={bookPath(next.book.id)} tabIndex={-1} aria-hidden="true">
              <Cover hiveId={next.book.id} title={next.book.title} authors={next.book.authors} fallbackUrl={next.book.cover || next.book.thumbnail} size="sm" />
            </Link>
            <div className="continue-body">
              <Link className="small muted" to={seriesPath(s.author, s.title)}>
                {next.position ? `Book ${next.position} of ` : ''}
                {s.title}
              </Link>
              <Link className="name" to={bookPath(next.book.id)}>
                {next.book.title}
              </Link>
              <QuickAdd book={quickBook(next.book)} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

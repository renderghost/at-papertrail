import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Empty, ErrorNote, Loading, StatusPill } from '../components/bits'
import { Cover } from '../components/Cover'
import { QuickAdd } from '../components/QuickAdd'
import { positionLabel, quickBook } from '../components/Series'
import { useMaybeSession } from '../lib/auth'
import { parseSeries } from '../lib/bookhive/series'
import { STATUS } from '../lib/bookhive/types'
import { findBylineAuthor, type BylineBook } from '../lib/byline'
import { FEATURES } from '../lib/features'
import { formatDate, plural } from '../lib/format'
import { useDocumentTitle, useMyLibrary } from '../lib/hooks'
import { authorPath, bookPath } from '../lib/paths'
import { hasRead, seriesProgress } from '../lib/series'
import { useAuthorSeries, useByline } from '../lib/usePeople'

/** A series in reading order, and where you are in it (#61). Public. */
export function SeriesPage() {
  const { name = '', series = '' } = useParams()
  const me = useMaybeSession()
  const books = useAuthorSeries(name)
  const library = useMyLibrary()
  const byline = useByline()
  const progress = useMemo(() => (books.data ? seriesProgress(books.data, series, library.data ?? []) : null), [books.data, series, library.data])
  // The catalogue's own spelling of the name, rather than the URL's.
  const title = parseSeries(progress?.books[0]?.book.series)?.title ?? series
  useDocumentTitle(title)

  const forthcoming = useMemo<BylineBook[]>(() => {
    const author = FEATURES.byline && byline.data ? findBylineAuthor(byline.data, name) : null
    const wanted = series.trim().toLowerCase()
    return (author?.books ?? []).filter(
      (b) => b.value.status === 'forthcoming' && b.value.series?.name?.trim().toLowerCase() === wanted,
    )
  }, [byline.data, name, series])

  if (books.isPending || (me && library.isPending)) return <Loading />
  if (books.isError) return <ErrorNote error={books.error} />
  if (!progress?.books.length) {
    return (
      <Empty title={`No books from ${series} in BookHive's catalogue`}>
        <p>
          <Link to={authorPath(name)}>See everything by {name}</Link>.
        </p>
      </Empty>
    )
  }

  return (
    <article>
      <div className="page-header">
        <div>
          <p className="kicker">Series</p>
          <h1>{title}</h1>
          <p className="lede">
            by <Link to={authorPath(name)}>{name}</Link> · {plural(progress.total, 'book')}
            {progress.books.length > progress.total ? ` and ${plural(progress.books.length - progress.total, 'extra')}` : ''}
          </p>
          {me && (
            <p className="series-progress">
              {progress.read
                ? `You've read ${progress.read} of ${progress.total}.`
                : "You haven't started it yet."}
              {progress.next ? ` Next: ${progress.next.book.title}.` : progress.read ? ' All read.' : ''}
              {progress.gaps.length ? ` You skipped ${plural(progress.gaps.length, 'book')}.` : ''}
            </p>
          )}
        </div>
      </div>

      <ol className="series-books">
        {progress.books.map((b) => {
          const next = b === progress.next
          const gap = progress.gaps.includes(b)
          return (
            <li key={b.book.id} className={[next ? 'next' : '', !b.main ? 'extra' : ''].join(' ').trim() || undefined}>
              <Link to={bookPath(b.book.id)} tabIndex={-1} aria-hidden="true">
                <Cover hiveId={b.book.id} title={b.book.title} authors={b.book.authors} entry={b.entry} fallbackUrl={b.book.cover || b.book.thumbnail} size="sm" />
              </Link>
              <div className="series-book-body">
                <span className="small muted">
                  {positionLabel(b.position) || 'Unnumbered'}
                  {!b.main ? (b.position?.includes('-') ? ' · collection' : ' · novella or extra') : ''}
                  {b.book.publicationYear ? ` · ${b.book.publicationYear}` : ''}
                </span>
                <Link className="name" to={bookPath(b.book.id)}>
                  {b.book.title}
                </Link>
                <div className="row series-book-state">
                  {next && <span className="badge badge-hive">Up next</span>}
                  {gap && <span className="badge">Missed</span>}
                  {me && (b.entry ? <StatusPill status={b.entry.value.status} /> : <QuickAdd book={quickBook(b.book)} />)}
                  {hasRead(b.entry) && b.entry?.value.status !== STATUS.finished && <span className="small muted">read before</span>}
                </div>
              </div>
            </li>
          )
        })}
      </ol>

      {forthcoming.length > 0 && (
        <section className="section">
          <div className="section-title">
            <h2>Coming soon</h2>
            <span className="count">from the author, on Byline</span>
          </div>
          <ul className="members">
            {forthcoming.map((b) => (
              <li key={b.uri} className="member">
                <div className="body">
                  <strong>{b.value.title}</strong>
                  <div className="small muted">
                    {b.value.series?.position ? `Book ${b.value.series.position}` : 'Forthcoming'}
                    {b.value.publicationDate ? ` · out ${formatDate(b.value.publicationDate)}` : ''}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  )
}

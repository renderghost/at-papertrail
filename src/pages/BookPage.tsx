import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Avatar, Empty, ErrorNote, Loading, Stars, StatusPill } from '../components/bits'
import { BookEditor } from '../components/BookEditor'
import { Cover } from '../components/Cover'
import { Icon } from '../components/Icon'
import { useSession } from '../lib/auth'
import { sameBookKeys } from '../lib/bookclub'
import { displayAuthors } from '../lib/bookhive/authors'
import { bookhiveBookUrl } from '../lib/bookhive/catalog'
import { STATUS, STATUS_LABEL, type BookEntry, type BookStatus, type CatalogBook } from '../lib/bookhive/types'
import { displayName, formatDate, plural, truncate } from '../lib/format'
import { useBookWrites, useCatalog, useMyLibrary } from '../lib/hooks'
import { networkStore, type Reader } from '../lib/network'
import { lookupBookDetails, newBookRecord } from '../lib/search'

type LocationState = { entry?: BookEntry; justAdded?: boolean } | null

export function BookPage() {
  const { hiveId = '' } = useParams()
  const location = useLocation()
  const state = location.state as LocationState
  const { did } = useSession()
  const library = useMyLibrary()
  const catalog = useCatalog(hiveId)

  const mine = library.data?.find((e) => e.value.hiveId === hiveId)
  // Someone else's copy, for books opened from the feed or a profile.
  const theirs = useMemo(() => {
    if (state?.entry && state.entry.value.hiveId === hiveId) return state.entry
    for (const reader of networkStore.getSnapshot().readers) {
      const found = reader.books.find((b) => b.value.hiveId === hiveId)
      if (found) return found
    }
    return undefined
  }, [state, hiveId])
  const known = mine ?? theirs

  const fallback = useQuery({
    queryKey: ['details', hiveId],
    queryFn: ({ signal }) =>
      lookupBookDetails(
        { title: known!.value.title, authors: known!.value.authors, isbn13: known!.value.identifiers?.isbn13 },
        signal,
      ),
    enabled: catalog.isFetched && !catalog.data && !!known,
    staleTime: 60 * 60 * 1000,
  })

  if (library.isPending || catalog.isPending) return <Loading />
  if (!catalog.data && !known) {
    return catalog.isError ? (
      <ErrorNote error={catalog.error} />
    ) : (
      <Empty title="We couldn't find this book">
        <p>It isn't in your library or BookHive's catalogue.</p>
        <Link className="btn" to="/add">
          Search for it
        </Link>
      </Empty>
    )
  }

  const title = catalog.data?.title ?? known!.value.title
  const authors = catalog.data?.authors ?? known!.value.authors
  const details = fallback.data

  return (
    <article>
      <div className="book-hero">
        <Cover
          hiveId={hiveId}
          title={title}
          authors={authors}
          entry={mine ?? theirs}
          fallbackUrl={details?.coverUrl}
          size="lg"
        />
        <div>
          <div className="row" style={{ marginBottom: 10 }}>
            {mine && <StatusPill status={mine.value.status} />}
            {catalog.data ? (
              <span className="badge badge-hive">
                <Icon name="check" size={14} /> On BookHive
              </span>
            ) : (
              <span className="badge">Not in BookHive's catalogue yet</span>
            )}
          </div>
          <h1>{title}</h1>
          <p className="byline">by {displayAuthors(authors)}</p>
          <Facts catalog={catalog.data ?? null} pages={details?.pages} year={details?.year} publisher={details?.publisher} />
          <Description text={catalog.data?.description ?? details?.description} />
          {(catalog.data?.genres ?? details?.subjects)?.length ? (
            <div className="tags">
              {(catalog.data?.genres ?? details?.subjects ?? []).slice(0, 10).map((g) => (
                <span key={g} className="tag">
                  {g}
                </span>
              ))}
            </div>
          ) : null}
          <div className="row" style={{ marginTop: 20 }}>
            {catalog.data && (
              <a className="btn btn-sm" href={bookhiveBookUrl(hiveId)} target="_blank" rel="noreferrer">
                BookHive <Icon name="external" size={14} />
              </a>
            )}
            {catalog.data?.sourceUrl?.startsWith('https://') && (
              <a className="btn btn-sm btn-quiet" href={catalog.data.sourceUrl} target="_blank" rel="noreferrer">
                {catalog.data.source ?? 'Source'} <Icon name="external" size={14} />
              </a>
            )}
          </div>
        </div>
      </div>

      <section className="section">
        <div className="section-title">
          <h2>{mine ? 'Your reading' : 'Add to your library'}</h2>
        </div>
        {state?.justAdded && mine && (
          <div className="notice notice-ok" style={{ marginBottom: 16 }}>
            Added to your library as {STATUS_LABEL[mine.value.status as BookStatus] ?? 'a book'}.
          </div>
        )}
        {mine ? (
          <BookEditor entry={mine} totalPagesHint={catalog.data?.numPages ?? details?.pages} />
        ) : (
          <AddFromPage
            hiveId={hiveId}
            title={title}
            authors={authors}
            catalog={catalog.data ?? null}
            source={theirs}
          />
        )}
      </section>

      <NetworkReaders did={did} entry={known} hiveId={hiveId} />
    </article>
  )
}

function Facts({
  catalog,
  pages,
  year,
  publisher,
}: {
  catalog: CatalogBook | null
  pages?: number
  year?: number
  publisher?: string
}) {
  const p = catalog?.numPages ?? pages
  const y = catalog?.publicationYear ?? year
  const pub = catalog?.publisher ?? publisher
  const rating = catalog?.rating ? catalog.rating / 1000 : null
  return (
    <div className="facts">
      {p ? (
        <span>
          <strong>{p.toLocaleString('en-GB')}</strong> pages
        </span>
      ) : null}
      {y ? (
        <span>
          Published <strong>{y}</strong>
        </span>
      ) : null}
      {pub ? <span>{pub}</span> : null}
      {catalog?.series ? <span>Series: {catalog.series}</span> : null}
      {rating ? (
        <span>
          <strong>{rating.toFixed(2)}</strong> average
          {catalog?.ratingsCount ? ` from ${plural(catalog.ratingsCount, 'rating')}` : ''}
        </span>
      ) : null}
    </div>
  )
}

function Description({ text }: { text: string | undefined }) {
  const [open, setOpen] = useState(false)
  if (!text) return null
  const clean = text.replace(/<[^>]+>/g, '')
  const long = clean.length > 600
  return (
    <>
      <p className={`description${long && !open ? ' clamped' : ''}`}>{clean}</p>
      {long && (
        <button className="btn btn-quiet btn-sm" onClick={() => setOpen((o) => !o)} style={{ marginTop: 6 }}>
          {open ? 'Show less' : 'Read more'}
        </button>
      )}
    </>
  )
}

function AddFromPage({
  hiveId,
  title,
  authors,
  catalog,
  source,
}: {
  hiveId: string
  title: string
  authors: string
  catalog: CatalogBook | null
  source: BookEntry | undefined
}) {
  const navigate = useNavigate()
  const { create } = useBookWrites()
  const [pending, setPending] = useState<BookStatus | null>(null)
  const add = async (status: BookStatus) => {
    setPending(status)
    try {
      const identifiers = source?.value.identifiers
      const record = newBookRecord({ hiveId, title, authors, identifiers }, catalog, status)
      const entry = await create.mutateAsync(record)
      navigate(`/book/${hiveId}`, { replace: true, state: { entry, justAdded: true } })
    } finally {
      setPending(null)
    }
  }
  return (
    <div className="panel">
      <p className="muted" style={{ marginBottom: 12 }}>
        This book isn't in your library yet.
      </p>
      <div className="row">
        {[STATUS.wantToRead, STATUS.reading, STATUS.finished].map((s) => (
          <button
            key={s}
            className={`btn${s === STATUS.reading ? ' btn-primary' : ''}`}
            disabled={pending !== null}
            onClick={() => void add(s)}
          >
            {pending === s ? 'Adding…' : STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      {create.isError && <ErrorNote error={create.error} />}
    </div>
  )
}

function NetworkReaders({ did, entry, hiveId }: { did: string; entry: BookEntry | undefined; hiveId: string }) {
  const readers = networkStore.getSnapshot().readers
  const matches = useMemo(() => {
    const keys = new Set(entry ? sameBookKeys(entry) : [`hive:${hiveId}`])
    const found: { reader: Reader; book: BookEntry }[] = []
    for (const reader of readers) {
      if (reader.profile.did === did) continue
      const book = reader.books.find((b) => sameBookKeys(b).some((k) => keys.has(k)))
      if (book) found.push({ reader, book })
    }
    return found
  }, [readers, entry, hiveId, did])

  if (readers.length === 0) {
    return (
      <p className="muted small section">
        Open your <Link to="/feed">feed</Link> to see who in your network has this book.
      </p>
    )
  }
  if (matches.length === 0) return null
  return (
    <section className="section">
      <div className="section-title">
        <h2>In your network</h2>
        <span className="count">{matches.length}</span>
      </div>
      <ul className="members">
        {matches.map(({ reader, book }) => (
          <li key={reader.profile.did} className="member">
            <Avatar profile={reader.profile} size={36} />
            <div className="body">
              <Link className="name" to={`/profile/${reader.profile.handle}`}>
                {displayName(reader.profile)}
              </Link>{' '}
              <StatusPill status={book.value.status} />
              <div className="small muted">
                {book.value.finishedAt && book.value.status === STATUS.finished
                  ? `Finished ${formatDate(book.value.finishedAt)}`
                  : book.value.startedAt
                    ? `Started ${formatDate(book.value.startedAt)}`
                    : `Added ${formatDate(book.value.createdAt)}`}{' '}
                <Stars stars={book.value.stars} size={13} />
              </div>
              {book.value.review && <p className="review">{truncate(book.value.review, 280)}</p>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

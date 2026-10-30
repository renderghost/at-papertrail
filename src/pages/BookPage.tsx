import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Avatar, Empty, ErrorNote, Loading, Stars, StatusPill } from '../components/bits'
import { AuthorLinks } from '../components/AuthorLinks'
import { BookEditor } from '../components/BookEditor'
import { BylinePanel } from '../components/BylinePanel'
import { Cover } from '../components/Cover'
import { Icon } from '../components/Icon'
import { AddToList } from '../components/Lists'
import { RatingBars } from '../components/RatingBars'
import { ReviewText } from '../components/ReviewText'
import { SeriesSection } from '../components/Series'
import { useMaybeSession } from '../lib/auth'
import { firstAuthor } from '../lib/bookhive/authors'
import { sameBookKeys } from '../lib/bookclub'
import type { HiveActivity, HiveBookDetail, HiveComment, HiveReview } from '../lib/bookhive/api'
import { bookhiveBookUrl } from '../lib/bookhive/catalog'
import { describeSeries, parseSeries } from '../lib/bookhive/series'
import { STATUS, STATUS_LABEL, type BookEntry, type BookIdentifiers, type BookStatus, type CatalogBook } from '../lib/bookhive/types'
import { displayName, formatDate, plural } from '../lib/format'
import { useBookWrites, useCatalog, useDocumentTitle, useHiveBook, useMyLibrary } from '../lib/hooks'
import { useNetwork, type Reader } from '../lib/network'
import { bookPath, loginPath, profilePath, seriesPath } from '../lib/paths'
import { reviewMatches, type ReviewEntry } from '../lib/popfeed'
import { lookupBookDetails, newBookRecord } from '../lib/search'

type LocationState = { entry?: BookEntry; justAdded?: boolean } | null

/** A book's page: public, so it works signed out; your own reading and network appear when signed in. */
export function BookPage() {
  const { hiveId = '' } = useParams()
  const location = useLocation()
  const state = location.state as LocationState
  const me = useMaybeSession()
  const library = useMyLibrary()
  const catalog = useCatalog(hiveId)
  const hive = useHiveBook(hiveId)
  const network = useNetwork(me?.did)

  const mine = library.data?.find((e) => e.value.hiveId === hiveId)
  // Someone else's copy, for books opened from the feed or a profile.
  const theirs = useMemo(() => {
    if (state?.entry && state.entry.value.hiveId === hiveId) return state.entry
    for (const reader of network.readers) {
      const found = reader.books.find((b) => b.value.hiveId === hiveId)
      if (found) return found
    }
    return undefined
  }, [state, hiveId, network.readers])
  const known = mine ?? theirs
  // The catalogue record, else BookHive's API copy of it (the same data, from its database).
  const book: CatalogBook | null = catalog.data ?? hive.data?.book ?? null

  const fallback = useQuery({
    queryKey: ['details', hiveId],
    queryFn: ({ signal }) =>
      lookupBookDetails(
        { title: known!.value.title, authors: known!.value.authors, isbn13: known!.value.identifiers?.isbn13 },
        signal,
      ),
    enabled: catalog.isFetched && !book && !hive.isPending && !!known,
    staleTime: 60 * 60 * 1000,
  })

  const title = book?.title ?? known?.value.title
  useDocumentTitle(title)

  if ((me && library.isPending) || catalog.isPending || (!catalog.data && hive.isPending)) return <Loading />
  if (!book && !known) {
    return catalog.isError ? (
      <ErrorNote error={catalog.error} />
    ) : (
      <Empty title="We couldn't find this book">
        <p>It isn't in {me ? 'your library or ' : ''}BookHive's catalogue.</p>
        {me && (
          <Link className="btn" to="/add">
            Search for it
          </Link>
        )}
      </Empty>
    )
  }

  const authors = book?.authors ?? known!.value.authors
  const details = fallback.data
  const identifiers: BookIdentifiers = { ...known?.value.identifiers, ...book?.identifiers, hiveId }
  const series = parseSeries(book?.series)

  return (
    <article>
      <div className="book-hero">
        <Cover hiveId={hiveId} title={title!} authors={authors} entry={known} fallbackUrl={details?.coverUrl} size="lg" />
        <div>
          <div className="row" style={{ marginBottom: 10 }}>
            {mine && <StatusPill status={mine.value.status} />}
            {book ? (
              <span className="badge badge-hive">
                <Icon name="check" size={14} /> On BookHive
              </span>
            ) : (
              <span className="badge">Not in BookHive's catalogue yet</span>
            )}
          </div>
          <h1>{title}</h1>
          <p className="byline">
            by <AuthorLinks authors={authors} />
          </p>
          {series && (
            <p className="series">
              <Link to={seriesPath(firstAuthor(authors), series.title)}>{describeSeries(series)}</Link>
            </p>
          )}
          <Facts catalog={book} pages={details?.pages} year={details?.year} publisher={details?.publisher} />
          <Description text={book?.description ?? details?.description} />
          {(book?.genres ?? details?.subjects)?.length ? (
            <div className="tags">
              {(book?.genres ?? details?.subjects ?? []).slice(0, 10).map((g) => (
                <span key={g} className="tag">
                  {g}
                </span>
              ))}
            </div>
          ) : null}
          <div className="row" style={{ marginTop: 20 }}>
            {book && (
              <a className="btn btn-sm" href={bookhiveBookUrl(hiveId)} target="_blank" rel="noreferrer">
                BookHive <Icon name="external" size={14} />
              </a>
            )}
            {book?.sourceUrl?.startsWith('https://') && (
              <a className="btn btn-sm btn-quiet" href={book.sourceUrl} target="_blank" rel="noreferrer">
                {book.source ?? 'Source'} <Icon name="external" size={14} />
              </a>
            )}
          </div>
        </div>
      </div>

      <section className="section">
        <div className="section-title">
          <h2>{mine ? 'Your reading' : me ? 'Add to your library' : 'Track this book'}</h2>
        </div>
        {!me ? (
          <div className="panel">
            <p style={{ marginBottom: 12 }}>
              Sign in with your Bluesky or AT Protocol account to add it to your library, track your progress and review
              it. Everything you write is saved on your own PDS and shows on BookHive too.
            </p>
            <Link className="btn btn-primary" to={loginPath(location.pathname)}>
              Sign in
            </Link>
          </div>
        ) : mine ? (
          <>
            {state?.justAdded && (
              <div className="notice notice-ok" style={{ marginBottom: 16 }}>
                Added to your library as {STATUS_LABEL[mine.value.status as BookStatus] ?? 'a book'}.
              </div>
            )}
            <BookEditor entry={mine} totalPagesHint={book?.numPages ?? details?.pages} />
            <ReadHistory entry={mine} />
          </>
        ) : (
          <AddFromPage hiveId={hiveId} title={title!} authors={authors} catalog={book} source={theirs} />
        )}
      </section>

      <SeriesSection book={book} mine={mine} />

      {me && (
        <section className="section-tight">
          <AddToList
            did={me.did}
            book={{ hiveId, title: title!, authors, identifiers, coverUrl: book?.cover ?? details?.coverUrl, genres: book?.genres }}
          />
        </section>
      )}

      <BylinePanel hiveId={hiveId} identifiers={identifiers} />

      {me && <NetworkReaders did={me.did} readers={network.readers} entry={known} hiveId={hiveId} identifiers={identifiers} loading={network.status === 'loading'} />}

      <BookHiveCommunity
        detail={hive.data ?? null}
        failed={hive.isError}
        hiveId={hiveId}
        myDid={me?.did}
        networkDids={new Set(network.readers.map((r) => r.profile.did))}
        ratingsDistribution={book?.ratingsDistribution}
        source={book?.source}
      />
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

/** Earlier reads of a re-read book, from BookHive's `previousReads`. */
function ReadHistory({ entry }: { entry: BookEntry }) {
  const reads = entry.value.previousReads ?? []
  if (reads.length === 0) return null
  return (
    <div className="read-history">
      <h3 className="club-group-label">Earlier reads</h3>
      <ul>
        {reads.map((r, i) => (
          <li key={`${r.finishedAt}-${i}`}>
            {r.startedAt ? `${formatDate(r.startedAt)} – ` : 'Finished '}
            {formatDate(r.finishedAt)}
          </li>
        ))}
      </ul>
    </div>
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
      navigate(bookPath(hiveId), { replace: true, state: { entry, justAdded: true } })
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

type NetworkMatch = { reader: Reader; book?: BookEntry; review?: ReviewEntry }

/** People you follow who have this book on BookHive or reviewed it on PopFeed. */
/** Who in your network has this book, and what they thought; also the scanner's bookshop mode. */
export function NetworkReaders({
  did,
  readers,
  entry,
  hiveId,
  identifiers,
  loading,
}: {
  did: string
  readers: Reader[]
  entry: BookEntry | undefined
  hiveId: string
  identifiers: BookIdentifiers
  loading: boolean
}) {
  const matches = useMemo(() => {
    const keys = new Set(entry ? sameBookKeys(entry) : [`hive:${hiveId}`])
    if (identifiers.isbn13) keys.add(`isbn:${identifiers.isbn13}`)
    const found: NetworkMatch[] = []
    for (const reader of readers) {
      if (reader.profile.did === did) continue
      const book = reader.books.find((b) => sameBookKeys(b).some((k) => keys.has(k)))
      const review = reader.reviews.find((r) => reviewMatches(r.value, { hiveId, identifiers }))
      if (book || review) found.push({ reader, book, review })
    }
    return found
  }, [readers, entry, hiveId, identifiers, did])

  if (matches.length === 0) {
    return loading ? <p className="muted small section">Checking who in your network has this book…</p> : null
  }
  return (
    <section className="section">
      <div className="section-title">
        <h2>In your network</h2>
        <span className="count">{matches.length}</span>
      </div>
      <ul className="members">
        {matches.map(({ reader, book, review }) => (
          <li key={reader.profile.did} className="member">
            <Avatar profile={reader.profile} size={36} />
            <div className="body">
              <Link className="name" to={profilePath(reader.profile.handle)}>
                {displayName(reader.profile)}
              </Link>{' '}
              {book && <StatusPill status={book.value.status} />}
              <div className="small muted">
                {book
                  ? book.value.finishedAt && book.value.status === STATUS.finished
                    ? `Finished ${formatDate(book.value.finishedAt)}`
                    : book.value.startedAt
                      ? `Started ${formatDate(book.value.startedAt)}`
                      : `Added ${formatDate(book.value.createdAt)}`
                  : `Reviewed on PopFeed ${formatDate(review!.value.createdAt)}`}{' '}
                <Stars stars={book?.value.stars ?? (review?.value.rating || undefined)} size={13} />
              </div>
              <ReviewText text={book?.value.review} />
              {review && (!book?.value.review || review.value.text) && (
                <>
                  {book && review.value.text && <div className="small muted review-source">On PopFeed:</div>}
                  <ReviewText text={review.value.text} spoilers={review.value.containsSpoilers} />
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Counts of distinct readers per kind of recent activity. */
function activitySummary(activity: HiveActivity[]): string[] {
  const byType = new Map<string, Set<string>>()
  for (const a of activity) {
    const set = byType.get(a.type) ?? new Set<string>()
    set.add(a.userDid)
    byType.set(a.type, set)
  }
  const label: Record<string, string> = { finished: 'finished', started: 'started', review: 'reviewed', rated: 'rated' }
  return ['finished', 'started', 'review', 'rated']
    .filter((t) => byType.get(t)?.size)
    .map((t) => `${byType.get(t)!.size.toLocaleString('en-GB')} ${label[t]}`)
}

/** Everyone on BookHive: their reviews and discussion of this book. */
function BookHiveCommunity({
  detail,
  failed,
  hiveId,
  myDid,
  networkDids,
  ratingsDistribution,
  source,
}: {
  detail: HiveBookDetail | null
  failed: boolean
  hiveId: string
  myDid: string | undefined
  networkDids: Set<string>
  ratingsDistribution: unknown
  source: string | undefined
}) {
  const reviews = useMemo(
    () => [...(detail?.reviews ?? [])].filter((r) => r.review?.trim()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [detail],
  )
  const comments = useMemo(
    () => [...(detail?.comments ?? [])].filter((c) => c.comment?.trim()).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [detail],
  )
  const summary = activitySummary(detail?.activity ?? [])
  const hasBars = !!ratingsDistribution
  if (!detail && !hasBars) {
    return failed ? (
      <p className="muted small section">BookHive's reviews couldn't be loaded just now.</p>
    ) : null
  }

  return (
    <section className="section">
      <div className="section-title">
        <h2>On BookHive</h2>
        {reviews.length > 0 && <span className="count">{plural(reviews.length, 'review')}</span>}
      </div>
      <div className="community">
        <div>
          {summary.length > 0 && <p className="small muted">Recently: {summary.join(' · ')}</p>}
          {reviews.length === 0 && detail && <p className="muted">No reviews on BookHive yet.</p>}
          <ul className="members">
            {reviews.map((r) => (
              <HiveReviewItem key={r.uri ?? `${r.did}-${r.createdAt}`} review={r} isMe={r.did === myDid} inNetwork={networkDids.has(r.did)} />
            ))}
          </ul>
          {comments.length > 0 && (
            <>
              <h3 className="club-group-label">Discussion</h3>
              <ul className="members">
                {comments.map((c) => (
                  <HiveCommentItem key={c.uri ?? `${c.did}-${c.createdAt}`} comment={c} />
                ))}
              </ul>
            </>
          )}
          <p className="small muted" style={{ marginTop: 12 }}>
            <a href={`${bookhiveBookUrl(hiveId)}/comments`} target="_blank" rel="noreferrer">
              Join the discussion on BookHive <Icon name="external" size={12} />
            </a>
          </p>
        </div>
        <RatingBars distribution={ratingsDistribution} source={source} />
      </div>
    </section>
  )
}

function HiveReviewItem({ review, isMe, inNetwork }: { review: HiveReview; isMe: boolean; inNetwork: boolean }) {
  return (
    <li className="member">
      <Avatar profile={{ handle: review.handle }} size={32} />
      <div className="body">
        <Link className="name" to={profilePath(review.handle)}>
          @{review.handle}
        </Link>{' '}
        {isMe ? <span className="badge">You</span> : inNetwork ? <span className="badge">You follow</span> : null}
        <div className="small muted">
          {formatDate(review.createdAt)} <Stars stars={review.stars} size={13} />
        </div>
        <ReviewText text={review.review} />
      </div>
    </li>
  )
}

function HiveCommentItem({ comment }: { comment: HiveComment }) {
  return (
    <li className="member">
      <Avatar profile={{ handle: comment.handle }} size={28} />
      <div className="body">
        <Link className="name" to={profilePath(comment.handle)}>
          @{comment.handle}
        </Link>
        <span className="small muted"> · {formatDate(comment.createdAt)}</span>
        <p className="comment">{comment.comment}</p>
      </div>
    </li>
  )
}

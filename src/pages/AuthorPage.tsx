import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Avatar, Empty, Loading, Stars, StatusPill } from '../components/bits'
import { Cover } from '../components/Cover'
import { FollowButton } from '../components/FollowButton'
import { Icon } from '../components/Icon'
import { useMaybeSession } from '../lib/auth'
import { groupBibliography, isBy, mergeEditions } from '../lib/bibliography'
import type { HiveBook } from '../lib/bookhive/api'
import { describeSeries, parseSeries } from '../lib/bookhive/series'
import { STATUS, type BookEntry } from '../lib/bookhive/types'
import {
  bylineAvatarUrl,
  bylineCoverUrl,
  bylineLinks,
  bylineStatusLabel,
  findBylineAuthor,
  plainText,
  type BylineAuthor,
} from '../lib/byline'
import { FEATURES } from '../lib/features'
import { displayName, formatDate, plural } from '../lib/format'
import { useDocumentTitle, useMyLibrary } from '../lib/hooks'
import { useNetwork } from '../lib/network'
import { bookPath, profilePath } from '../lib/paths'
import { useAuthorBooks, useByline } from '../lib/usePeople'

/** /authors/:name, as on bookhive.buzz: an author's books, your history with them, and their own words if they're on Byline. */
export function AuthorPage() {
  const { name: raw = '' } = useParams()
  const name = decodeURIComponent(raw)
  const me = useMaybeSession()
  const books = useAuthorBooks(name)
  const byline = useByline()
  const library = useMyLibrary()
  const network = useNetwork(me?.did)
  useDocumentTitle(name)

  const author = FEATURES.byline && byline.data ? findBylineAuthor(byline.data, name) : null
  const works = useMemo(() => mergeEditions(books.data?.books ?? []), [books.data])
  const grouped = useMemo(() => groupBibliography(works), [works])
  const mine = useMemo(() => (library.data ?? []).filter((e) => isBy(e.value.authors, name)), [library.data, name])
  const byHive = useMemo(() => new Map(mine.map((e) => [e.value.hiveId, e])), [mine])
  const friends = useMemo(
    () =>
      network.readers
        .filter((r) => r.profile.did !== me?.did)
        .map((r) => ({ reader: r, books: r.books.filter((b) => isBy(b.value.authors, name)) }))
        .filter((r) => r.books.length > 0)
        .sort((a, b) => b.books.length - a.books.length),
    [network.readers, me?.did, name],
  )
  const catalogBio = works.find((b) => b.authorBio?.trim())?.authorBio

  if (books.isPending && (!FEATURES.byline || byline.isPending)) return <Loading />
  const nothing = works.length === 0 && !author && mine.length === 0
  if (nothing && !books.isPending) {
    return (
      <Empty title={`We couldn't find books by ${name}`}>
        <p>BookHive's catalogue has nothing under this name. Try the spelling on the book's page.</p>
      </Empty>
    )
  }

  return (
    <article>
      <AuthorHeader name={name} author={author} catalogBio={catalogBio} bookCount={works.length} />

      {me && mine.length > 0 && <YouAndAuthor mine={mine} />}

      {friends.length > 0 && (
        <section className="section">
          <div className="section-title">
            <h2>Read by people you follow</h2>
            <span className="count">{friends.length}</span>
          </div>
          <ul className="avatar-row">
            {friends.slice(0, 12).map(({ reader, books: theirs }) => (
              <li key={reader.profile.did}>
                <Link to={profilePath(reader.profile.handle)} title={`${displayName(reader.profile)}: ${plural(theirs.length, 'book')}`}>
                  <Avatar profile={reader.profile} size={40} />
                  <span className="small">{displayName(reader.profile)}</span>
                  <span className="small muted">{plural(theirs.length, 'book')}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {author && <BylineBooks author={author} catalogued={works} />}

      {books.isError && <p className="muted small section">BookHive's catalogue couldn't be reached just now.</p>}
      {grouped.series.map((g) => (
        <section className="section" key={g.series}>
          <div className="section-title">
            <h2>{g.series}</h2>
            <span className="count">Series</span>
          </div>
          <BookGrid books={g.books} byHive={byHive} />
        </section>
      ))}
      {grouped.standalone.length > 0 && (
        <section className="section">
          <div className="section-title">
            <h2>{grouped.series.length ? 'Other books' : 'Books'}</h2>
            <span className="count">{grouped.standalone.length}</span>
          </div>
          <BookGrid books={grouped.standalone} byHive={byHive} />
        </section>
      )}
    </article>
  )
}

function AuthorHeader({
  name,
  author,
  catalogBio,
  bookCount,
}: {
  name: string
  author: BylineAuthor | null
  catalogBio: string | undefined
  bookCount: number
}) {
  const avatar = author ? bylineAvatarUrl(author) : null
  const bio = author?.profile?.bio ? plainText(author.profile.bio) : catalogBio
  const links = bylineLinks(author?.profile?.links).slice(0, 5)
  return (
    <div className="page-header profile-header">
      <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
        {avatar ? (
          <img className="avatar" src={avatar} alt="" width={80} height={80} />
        ) : (
          <Avatar profile={{ handle: name, displayName: name }} size={80} />
        )}
        <div>
          <p className="kicker">Author{author ? ' · on Byline' : ''}</p>
          <h1>{author?.profile?.displayName ?? name}</h1>
          {author?.profile?.penNames?.length ? (
            <p className="muted small">Also writes as {author.profile.penNames.join(', ')}</p>
          ) : null}
          {bookCount > 0 && <p className="muted">{plural(bookCount, 'book')} on BookHive</p>}
          {bio && <p className="profile-bio">{bio}</p>}
          {!author?.profile?.bio && catalogBio && <p className="small muted">Biography from BookHive's catalogue.</p>}
          {links.length > 0 && (
            <p className="small profile-links">
              {links.map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noreferrer">
                  {l.label ?? new URL(l.url).host.replace(/^www\./, '')}
                </a>
              ))}
            </p>
          )}
        </div>
      </div>
      <div className="row">
        {author && <FollowButton did={author.did} name={author.profile?.displayName ?? name} />}
        <a className="btn btn-sm btn-quiet" href={`https://bookhive.buzz/authors/${encodeURIComponent(name)}`} target="_blank" rel="noreferrer">
          BookHive <Icon name="external" size={14} />
        </a>
      </div>
      {FEATURES.byline && !author && (
        <p className="small muted claim">
          Are you {name}? <a href="https://byline.pub" target="_blank" rel="noreferrer">Claim your author page on Byline</a>{' '}
          and your own blurbs, links and new releases will appear here.
        </p>
      )}
    </div>
  )
}

function YouAndAuthor({ mine }: { mine: BookEntry[] }) {
  const finished = mine.filter((e) => e.value.status === STATUS.finished || (e.value.previousReads?.length ?? 0) > 0)
  const rated = mine.filter((e) => e.value.stars)
  const average = rated.length ? rated.reduce((n, e) => n + (e.value.stars ?? 0), 0) / rated.length : null
  const dates = finished
    .flatMap((e) => [e.value.status === STATUS.finished ? e.value.finishedAt : undefined, ...(e.value.previousReads ?? []).map((r) => r.finishedAt)])
    .filter((d): d is string => !!d)
    .sort()
  return (
    <section className="section">
      <div className="section-title">
        <h2>You and this author</h2>
      </div>
      <div className="facts">
        <span>
          <strong>{mine.length}</strong> in your library
        </span>
        <span>
          <strong>{finished.length}</strong> read
        </span>
        {average !== null && (
          <span>
            <Stars stars={Math.round(average)} size={13} /> <strong>{(average / 2).toFixed(1)}</strong> your average
          </span>
        )}
        {dates.length > 0 && <span>First read {formatDate(dates[0])}</span>}
        {dates.length > 1 && <span>Latest {formatDate(dates[dates.length - 1])}</span>}
      </div>
    </section>
  )
}

function BookGrid({ books, byHive }: { books: HiveBook[]; byHive: Map<string, BookEntry> }) {
  return (
    <ul className="author-books">
      {books.map((b) => {
        const mine = byHive.get(b.id)
        const series = parseSeries(b.series)
        return (
          <li key={b.id}>
            <Link to={bookPath(b.id)} state={mine ? { entry: mine } : undefined}>
              <Cover hiveId={b.id} title={b.title} authors={b.authors} entry={mine} fallbackUrl={b.cover ?? b.thumbnail} size="md" />
            </Link>
            <div className="author-book-body">
              <Link className="name" to={bookPath(b.id)} state={mine ? { entry: mine } : undefined}>
                {b.title}
              </Link>
              <div className="small muted">
                {[b.publicationYear, series ? describeSeries(series).replace(/ of .*$/, '') : null, b.rating ? `${(b.rating / 1000).toFixed(2)} avg` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
              {mine && <StatusPill status={mine.value.status} />}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** Books the author lists on Byline that BookHive hasn't catalogued yet (forthcoming ones especially). */
function BylineBooks({ author, catalogued }: { author: BylineAuthor; catalogued: HiveBook[] }) {
  const known = new Set(catalogued.map((b) => b.id))
  const extra = author.books.filter(
    (b) => b.value.status !== 'pub.byline.defs#draft' && !(b.value.identifiers?.hiveId && known.has(b.value.identifiers.hiveId)),
  )
  if (extra.length === 0) return null
  return (
    <section className="section">
      <div className="section-title">
        <h2>From the author</h2>
        <span className="count">on Byline</span>
      </div>
      <ul className="author-books">
        {extra.map((b) => {
          const cover = bylineCoverUrl(b)
          const status = bylineStatusLabel(b.value.status)
          const primary = bylineLinks(b.value.links)[0]
          const inner = (
            <>
              <Cover hiveId={b.value.identifiers?.hiveId ?? ''} title={b.value.title} authors="" fallbackUrl={cover ?? undefined} size="md" />
            </>
          )
          return (
            <li key={b.uri}>
              {b.value.identifiers?.hiveId ? <Link to={bookPath(b.value.identifiers.hiveId)}>{inner}</Link> : inner}
              <div className="author-book-body">
                <span className="name">{b.value.title}</span>
                {b.value.tagline && <div className="small">{b.value.tagline}</div>}
                <div className="small muted">
                  {[status, b.value.publicationDate ? formatDate(b.value.publicationDate) : null].filter(Boolean).join(' · ')}
                </div>
                {primary && (
                  <a className="small" href={primary.url} target="_blank" rel="noreferrer">
                    {primary.label ?? (status === 'Forthcoming' ? 'Pre-order' : 'Get it')} <Icon name="external" size={12} />
                  </a>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Avatar, ErrorNote, Loading, Stars } from '../components/bits'
import { ReadingCard } from '../components/BookTile'
import { Cover } from '../components/Cover'
import { Favourites } from '../components/Favourites'
import { FollowButton } from '../components/FollowButton'
import { Icon } from '../components/Icon'
import { ListsGrid } from '../components/Lists'
import { ReviewText } from '../components/ReviewText'
import { Shelves } from '../components/Shelves'
import { shortName, TasteSection } from '../components/Taste'
import { useMaybeSession } from '../lib/auth'
import { displayAuthors } from '../lib/bookhive/authors'
import { STATUS, type BookEntry } from '../lib/bookhive/types'
import { displayName, formatDate, plural } from '../lib/format'
import { useDocumentTitle, useLibrary, useMyLibrary, useProfile } from '../lib/hooks'
import { bookPath, shelvesPath } from '../lib/paths'
import { useLists } from '../lib/useLists'
import { tasteMatch } from '../lib/taste'
import { usePopfeedProfile } from '../lib/usePeople'

const YEAR = String(new Date().getUTCFullYear())

function reviewedAt(e: BookEntry): string {
  return e.value.finishedAt ?? e.value.bookProgress?.updatedAt ?? e.value.createdAt
}

/** Your taste match with someone (#63), worked out from both your libraries. */
function YouAndThem({ books, name }: { books: BookEntry[]; name: string }) {
  const mine = useMyLibrary()
  const match = useMemo(() => (mine.data ? tasteMatch(mine.data, { books }) : null), [mine.data, books])
  return match ? <TasteSection match={match} name={name} /> : null
}

/** Anyone's reading life, read-only and public, straight from their PDS. */
export function Profile() {
  const { actor = '' } = useParams()
  const me = useMaybeSession()
  const profile = useProfile(actor)
  const did = profile.data?.did
  const library = useLibrary(did)
  const lists = useLists(did)
  const popfeed = usePopfeedProfile(did)
  useDocumentTitle(profile.data ? displayName(profile.data) : undefined)

  if (profile.isPending) return <Loading />
  if (profile.isError) return <ErrorNote error={profile.error} />
  const p = profile.data
  const isMe = p.did === me?.did
  const entries = library.data ?? []
  const reading = entries.filter((e) => e.value.status === STATUS.reading)
  const finished = entries.filter((e) => e.value.status === STATUS.finished)
  const finishedThisYear = entries.filter(
    (e) =>
      (e.value.status === STATUS.finished && e.value.finishedAt?.startsWith(YEAR)) ||
      (e.value.previousReads ?? []).some((r) => r.finishedAt.startsWith(YEAR)),
  )
  const reviews = entries
    .filter((e) => e.value.review?.trim())
    .sort((a, b) => reviewedAt(b).localeCompare(reviewedAt(a)))
    .slice(0, 5)
  const bio = popfeed.data?.value.description?.trim() || p.description?.trim()
  const links = (popfeed.data?.value.externalLinks ?? [])
    .map((l) => (typeof l === 'string' ? l : (l as { url?: unknown } | null)?.url))
    .filter((u): u is string => typeof u === 'string' && u.startsWith('https://'))
    .slice(0, 4)

  return (
    <>
      <div className="page-header profile-header">
        <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
          <Avatar profile={p} size={80} />
          <div>
            <p className="kicker">{isMe ? 'Your profile' : 'Reader'}</p>
            <h1>{displayName(p)}</h1>
            <p className="muted">@{p.handle}</p>
            {bio && <p className="profile-bio">{bio}</p>}
            {links.length > 0 && (
              <p className="small profile-links">
                {links.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer">
                    {new URL(url).host.replace(/^www\./, '')}
                  </a>
                ))}
              </p>
            )}
            {library.data && (
              <p className="facts" style={{ marginTop: 12 }}>
                <span>{plural(entries.length, 'book')}</span>
                <span>{finished.length.toLocaleString('en-GB')} finished</span>
                <span>
                  {finishedThisYear.length.toLocaleString('en-GB')} in {YEAR}
                </span>
                <span>{plural(entries.filter((e) => e.value.review?.trim()).length, 'review')}</span>
              </p>
            )}
          </div>
        </div>
        <div className="row">
          <FollowButton did={p.did} name={displayName(p)} />
          {isMe && (
            <>
              <Link className="btn btn-sm" to="/">
                Your library
              </Link>
              <Link className="btn btn-sm" to={`/covered/${YEAR}`}>
                Your {YEAR} Covered
              </Link>
            </>
          )}
          <a className="btn btn-sm btn-quiet" href={`https://bsky.app/profile/${p.handle}`} target="_blank" rel="noreferrer">
            Bluesky <Icon name="external" size={14} />
          </a>
          <a className="btn btn-sm btn-quiet" href={`https://bookhive.buzz/profile/${p.handle}`} target="_blank" rel="noreferrer">
            BookHive <Icon name="external" size={14} />
          </a>
        </div>
      </div>

      {library.isPending ? (
        <Loading>Reading their shelves…</Loading>
      ) : library.isError ? (
        <ErrorNote error={library.error} />
      ) : (
        <>
          {reading.length > 0 && (
            <section>
              <div className="section-title">
                <h2>Currently reading</h2>
                <span className="count">{reading.length}</span>
              </div>
              <div className="reading-list">
                {reading.map((e) => (
                  <ReadingCard key={e.uri} entry={e} />
                ))}
              </div>
            </section>
          )}

          {me && !isMe && <YouAndThem books={entries} name={shortName(p)} />}

          <Favourites did={p.did} isMe={isMe} />

          {(lists.data?.length || isMe) && (
            <section className="section">
              <div className="section-title">
                <h2>Lists</h2>
                <Link className="btn btn-quiet btn-sm" to={shelvesPath(p.handle)}>
                  {isMe ? 'Manage lists' : 'All lists'}
                </Link>
              </div>
              {lists.data?.length ? (
                <ListsGrid lists={lists.data.slice(0, 6)} owner={p.handle} />
              ) : (
                <p className="muted">No lists yet. Make one from any book's page, or from your lists.</p>
              )}
            </section>
          )}

          {reviews.length > 0 && (
            <section className="section">
              <div className="section-title">
                <h2>Latest reviews</h2>
              </div>
              <ul className="members">
                {reviews.map((e) => (
                  <li key={e.uri} className="member profile-review">
                    <Link to={bookPath(e.value.hiveId)} state={{ entry: e }} tabIndex={-1} aria-hidden="true">
                      <Cover hiveId={e.value.hiveId} title={e.value.title} authors={e.value.authors} entry={e} size="xs" />
                    </Link>
                    <div className="body">
                      <Link className="name" to={bookPath(e.value.hiveId)} state={{ entry: e }}>
                        {e.value.title}
                      </Link>
                      <div className="small muted">
                        {displayAuthors(e.value.authors)} · {formatDate(reviewedAt(e))} <Stars stars={e.value.stars} size={13} />
                      </div>
                      <ReviewText text={e.value.review} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="section">
            <div className="section-title">
              <h2>Shelves</h2>
              <span className="count">{plural(entries.length, 'book')}</span>
            </div>
            <Shelves entries={entries} emptyMessage={`${displayName(p)} hasn't logged any books on BookHive yet.`} />
          </section>
        </>
      )}
    </>
  )
}

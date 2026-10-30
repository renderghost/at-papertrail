import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Avatar, Empty, ErrorNote, Loading, Progress, Stars } from '../components/bits'
import { Cover } from '../components/Cover'
import { Icon } from '../components/Icon'
import { NetworkScan } from '../components/NetworkScan'
import { useSession } from '../lib/auth'
import { buildBookClub, type ClubBook, type ClubMember } from '../lib/bookclub'
import { displayAuthors } from '../lib/bookhive/authors'
import { displayName, formatDate, plural, truncate } from '../lib/format'
import { useMyLibrary } from '../lib/hooks'
import { useNetwork } from '../lib/network'
import { bookPath, PATHS } from '../lib/paths'

/** A Bluesky compose window, pre-filled to start the conversation. */
function composeUrl(book: ClubBook): string {
  const people = [...book.reading, ...book.haveRead].slice(0, 6).map((m) => `@${m.profile.handle}`)
  const text = `${people.join(' ')} I'm reading ${book.mine.value.title} — who's up for a book club? 📚`
  return `https://bsky.app/intent/compose?text=${encodeURIComponent(text)}`
}

export function BookClub() {
  const { did } = useSession()
  const library = useMyLibrary()
  const network = useNetwork(did)

  const club = useMemo(() => buildBookClub(library.data ?? [], network.readers), [library.data, network.readers])

  return (
    <>
      <div className="page-header">
        <div>
          <p className="kicker">Friends</p>
          <h1>Who's on the same page</h1>
          <p className="lede">
            For every book you're reading, the people you follow who are reading it now or have read it before.
          </p>
        </div>
      </div>

      <NetworkScan network={network} />

      {library.isPending ? (
        <Loading />
      ) : library.isError ? (
        <ErrorNote error={library.error} />
      ) : club.length === 0 ? (
        <Empty title="You're not reading anything right now">
          <p>Mark a book as Reading and your book club will gather here.</p>
          <Link to={PATHS.search} className="btn btn-primary">
            Find a book
          </Link>
        </Empty>
      ) : (
        <div className="club">
          {club.map((book) => (
            <ClubCard key={book.mine.uri} book={book} scanning={network.status === 'loading'} />
          ))}
        </div>
      )}
    </>
  )
}

function ClubCard({ book, scanning }: { book: ClubBook; scanning: boolean }) {
  const v = book.mine.value
  const total = book.reading.length + book.haveRead.length
  return (
    <section className="club-book">
      <Link to={bookPath(v.hiveId)} state={{ entry: book.mine }}>
        <Cover hiveId={v.hiveId} title={v.title} authors={v.authors} entry={book.mine} />
      </Link>
      <div style={{ minWidth: 0 }}>
        <h2>
          <Link to={bookPath(v.hiveId)} state={{ entry: book.mine }} style={{ textDecoration: 'none' }}>
            {v.title}
          </Link>
        </h2>
        <p className="muted">{displayAuthors(v.authors)}</p>
        <div style={{ maxWidth: 320, marginTop: 8 }}>
          <Progress progress={v.bookProgress} />
        </div>

        {total === 0 ? (
          <p className="muted small" style={{ marginTop: 16 }}>
            {scanning ? 'Still looking through your network…' : 'Nobody you follow has this one yet. You could be the first.'}
          </p>
        ) : (
          <>
            <div className="row" style={{ marginTop: 16, justifyContent: 'space-between' }}>
              <span className="small">
                {book.reading.length > 0 && <strong>{plural(book.reading.length, 'reading now', 'reading now')}</strong>}
                {book.reading.length > 0 && book.haveRead.length > 0 && ' · '}
                {book.haveRead.length > 0 && <span>{plural(book.haveRead.length, 'has read it', 'have read it')}</span>}
              </span>
              <a className="btn btn-sm" href={composeUrl(book)} target="_blank" rel="noreferrer">
                <Icon name="chat" size={16} /> Start a thread
              </a>
            </div>
            {book.reading.length > 0 && <Members label="Reading now" members={book.reading} />}
            {book.haveRead.length > 0 && <Members label="Have read it" members={book.haveRead} />}
          </>
        )}
      </div>
    </section>
  )
}

function Members({ label, members }: { label: string; members: ClubMember[] }) {
  return (
    <>
      <div className="club-group-label">{label}</div>
      <ul className="members">
        {members.map((m) => {
          const v = m.entry.value
          return (
            <li key={m.profile.did} className="member">
              <Avatar profile={m.profile} size={36} />
              <div className="body">
                <Link className="name" to={`/profile/${m.profile.handle}`}>
                  {displayName(m.profile)}
                </Link>
                <span className="muted small"> @{m.profile.handle}</span>
                <div className="small muted">
                  {m.finishedAt && label === 'Have read it'
                    ? `Finished ${formatDate(m.finishedAt)}`
                    : v.startedAt
                      ? `Started ${formatDate(v.startedAt)}`
                      : null}{' '}
                  <Stars stars={v.stars} size={13} />
                </div>
                {label === 'Reading now' && v.bookProgress && (
                  <div style={{ maxWidth: 240 }}>
                    <Progress progress={v.bookProgress} />
                  </div>
                )}
                {v.review && (
                  // You're mid-book: keep their review folded away.
                  <details className="small" style={{ marginTop: 6 }}>
                    <summary className="muted">Their review (may contain spoilers)</summary>
                    <p className="review">{truncate(v.review, 600)}</p>
                  </details>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}

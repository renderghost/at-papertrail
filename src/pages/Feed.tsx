import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar, Empty, Stars } from '../components/bits'
import { BookCard } from '../components/Cards'
import { NetworkScan } from '../components/NetworkScan'
import { useSession } from '../lib/auth'
import { buildFeed, FEED_FILTERS, matchesFilter, type FeedEvent, type FeedEventKind } from '../lib/feed'
import { displayName, formatRelativeDay, truncate } from '../lib/format'
import { useNetwork } from '../lib/network'
import { profilePath } from '../lib/paths'

const PAGE = 40

const VERB: Record<FeedEventKind, string> = {
  started: 'started reading',
  finished: 'finished',
  reviewed: 'reviewed',
  rated: 'rated',
  wantToRead: 'wants to read',
}

export function Feed() {
  const { did } = useSession()
  const network = useNetwork(did)
  const [filter, setFilter] = useState<FeedEventKind | 'all'>('all')
  const [limit, setLimit] = useState(PAGE)

  const events = useMemo(() => buildFeed(network.readers), [network.readers])
  const shown = useMemo(() => events.filter((e) => matchesFilter(e, filter)), [events, filter])

  return (
    <>
      <div className="page-header">
        <div>
          <p className="kicker">Discovery</p>
          <h1>What your network is reading</h1>
          <p className="lede">Starts, finishes, reviews and wish lists from the people you follow on Bluesky.</p>
        </div>
      </div>

      <NetworkScan network={network} />

      <div className="chips" role="group" aria-label="Filter the feed" style={{ marginBottom: 8 }}>
        {FEED_FILTERS.map((f) => (
          <button
            key={f.kind}
            className="chip"
            aria-pressed={filter === f.kind}
            onClick={() => {
              setFilter(f.kind)
              setLimit(PAGE)
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {shown.length === 0 && network.status === 'done' ? (
        <Empty title="Quiet on the shelves">
          <p>
            {network.readers.length === 0
              ? "Nobody you follow has logged a book on BookHive yet. Invite a friend — or follow a few readers on Bluesky."
              : 'Nothing matches this filter yet.'}
          </p>
        </Empty>
      ) : (
        <ol className="feed">
          {shown.slice(0, limit).map((event) => (
            <FeedItem key={event.id} event={event} />
          ))}
        </ol>
      )}
      {shown.length > limit && (
        <button className="btn" style={{ marginTop: 24 }} onClick={() => setLimit((l) => l + PAGE)}>
          Show more
        </button>
      )}
    </>
  )
}

/** A feed entry (#100): a person card saying what they did, with the book inset as its own card. */
function FeedItem({ event }: { event: FeedEvent }) {
  const { profile, entry } = event
  const v = entry.value
  return (
    <li className="feed-item">
      <article className="feed-entry">
        <Link to={profilePath(profile.handle)} tabIndex={-1} aria-hidden="true">
          <Avatar profile={profile} />
        </Link>
        <div className="feed-body">
          <p className="who">
            <Link to={profilePath(profile.handle)}>
              <strong>{displayName(profile)}</strong>
            </Link>{' '}
            <span className="verb">{event.earlierRead ? 'read' : VERB[event.kind]}</span>
            <span className="when">
              {' · '}
              {formatRelativeDay(event.date)}
              {event.earlierRead ? ' · an earlier read' : ''}
            </span>
          </p>
          {event.stars ? <Stars stars={event.stars} /> : null}
          {event.review && <p className="review">{truncate(event.review, 360)}</p>}
          <BookCard size="embed" book={{ hiveId: v.hiveId, title: v.title, authors: v.authors, identifiers: v.identifiers, entry }} state={{ entry }} />
        </div>
      </article>
    </li>
  )
}

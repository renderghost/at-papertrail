import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar, Empty, Stars } from '../components/bits'
import { Cover } from '../components/Cover'
import { NetworkScan } from '../components/NetworkScan'
import { useSession } from '../lib/auth'
import { displayAuthors } from '../lib/bookhive/authors'
import { buildFeed, FEED_FILTERS, matchesFilter, type FeedEvent, type FeedEventKind } from '../lib/feed'
import { displayName, formatRelativeDay, truncate } from '../lib/format'
import { useNetwork } from '../lib/network'

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

function FeedItem({ event }: { event: FeedEvent }) {
  const { profile, entry } = event
  const v = entry.value
  return (
    <li className="feed-item">
      <Link to={`/profile/${profile.handle}`} aria-label={displayName(profile)}>
        <Avatar profile={profile} />
      </Link>
      <div style={{ minWidth: 0 }}>
        <div className="who">
          <Link to={`/profile/${profile.handle}`} style={{ textDecoration: 'none' }}>
            <strong>{displayName(profile)}</strong>
          </Link>{' '}
          <span className="verb">
            {event.earlierRead ? 'read' : VERB[event.kind]}
          </span>
        </div>
        <Link className="what" to={`/book/${v.hiveId}`} state={{ entry }}>
          {v.title}
        </Link>
        <div className="muted small">{displayAuthors(v.authors)}</div>
        {event.stars ? (
          <div style={{ marginTop: 6 }}>
            <Stars stars={event.stars} />
          </div>
        ) : null}
        {event.review && <p className="review">{truncate(event.review, 360)}</p>}
        <div className="when">
          {formatRelativeDay(event.date)}
          {event.earlierRead ? ' · an earlier read' : ''}
        </div>
      </div>
      <Link to={`/book/${v.hiveId}`} state={{ entry }} tabIndex={-1} aria-hidden="true">
        <Cover hiveId={v.hiveId} title={v.title} authors={v.authors} entry={entry} size="sm" />
      </Link>
    </li>
  )
}

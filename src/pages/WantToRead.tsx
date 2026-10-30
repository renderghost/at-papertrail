import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Avatar, Empty, ErrorNote, Loading, Stars, StatusPill } from '../components/bits'
import { Cover } from '../components/Cover'
import { Icon } from '../components/Icon'
import { NetworkScan } from '../components/NetworkScan'
import { useSession } from '../lib/auth'
import { displayAuthors } from '../lib/bookhive/authors'
import { STATUS, type BookEntry } from '../lib/bookhive/types'
import { displayName } from '../lib/format'
import { useDocumentTitle, useMyLibrary } from '../lib/hooks'
import { useNetwork, type Reader } from '../lib/network'
import { bookPath, profilePath } from '../lib/paths'
import { askUrl, copiesOf, describeTake, networkIndex, networkTake, stoppedAt, trustScores, type NetworkCopy, type NetworkTake } from '../lib/taste'

type Row = { entry: BookEntry; copies: NetworkCopy<Reader>[]; take: NetworkTake }

/** Most worth it first: what readers loved, then what nobody you follow has tried, then what they gave up on. */
function rank({ take }: Row): number {
  if (!take.readers) return 0
  return (take.average ?? 3) + 0.5 * take.loved - take.abandoned
}

/** Your want-to-read list with your network's take on each book (#64), the people most like you first. */
export function WantToReadPage() {
  useDocumentTitle('Want to read, asked')
  const { did } = useSession()
  const library = useMyLibrary()
  const network = useNetwork(did)

  const rows = useMemo(() => {
    const mine = library.data ?? []
    const index = networkIndex(network.readers, did)
    const trust = trustScores(mine, network.readers, did)
    return mine
      .filter((e) => e.value.status === STATUS.wantToRead)
      .map((entry): Row => {
        const copies = copiesOf(entry, index, trust)
        return { entry, copies, take: networkTake(copies.map((c) => c.entry)) }
      })
      .sort((a, b) => rank(b) - rank(a))
  }, [library.data, network.readers, did])

  return (
    <>
      <div className="page-header">
        <div>
          <p className="kicker">Ask your network</p>
          <h1>Your want-to-read list, asked</h1>
          <p className="lede">
            What the people you follow made of each book you want to read: who loved it, who's reading it and who gave up (and where). The
            readers most like you come first.
          </p>
        </div>
      </div>

      <NetworkScan network={network} />

      {library.isPending ? (
        <Loading />
      ) : library.isError ? (
        <ErrorNote error={library.error} />
      ) : rows.length === 0 ? (
        <Empty title="Nothing on your want-to-read list">
          <p>Mark books as Want to read and your network's take on them will gather here.</p>
        </Empty>
      ) : (
        <ol className="members asked">
          {rows.map((row) => (
            <AskedBook key={row.entry.uri} row={row} />
          ))}
        </ol>
      )}
    </>
  )
}

function AskedBook({ row: { entry, copies, take } }: { row: Row }) {
  const v = entry.value
  const tried = copies.filter((c) => c.entry.value.status !== STATUS.wantToRead)
  return (
    <li className="member">
      <Link to={bookPath(v.hiveId)} state={{ entry }} tabIndex={-1} aria-hidden="true">
        <Cover hiveId={v.hiveId} title={v.title} authors={v.authors} entry={entry} size="sm" />
      </Link>
      <div className="body">
        <Link className="name" to={bookPath(v.hiveId)} state={{ entry }}>
          {v.title}
        </Link>
        <div className="small muted">{displayAuthors(v.authors)}</div>
        <p className="small verdict">{describeTake(take)}</p>
        {copies.length > 0 && (
          <ul className="network-copies">
            {copies.slice(0, 8).map((c) => (
              <NetworkCopyLine key={c.reader.profile.did} copy={c} />
            ))}
          </ul>
        )}
        {tried.length > 0 && (
          <a
            className="btn btn-sm"
            href={askUrl(
              v.title,
              tried.map((c) => c.reader.profile.handle),
              new URL(bookPath(v.hiveId), window.location.origin).href,
            )}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="chat" size={16} /> Ask them on Bluesky
          </a>
        )}
      </div>
    </li>
  )
}

/** One follow's copy: their status, rating, and where they stopped if they gave up. */
export function NetworkCopyLine({ copy: { reader, entry } }: { copy: NetworkCopy<Reader> }) {
  const stopped = stoppedAt(entry)
  return (
    <li>
      <Avatar profile={reader.profile} size={24} />
      <Link to={profilePath(reader.profile.handle)}>{displayName(reader.profile)}</Link>
      <StatusPill status={entry.value.status} />
      <Stars stars={entry.value.stars} size={12} />
      {stopped && <span className="small muted">stopped {stopped}</span>}
    </li>
  )
}

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Avatar, Empty, ErrorNote, Loading, Stars, StatusPill } from '../components/bits'
import { BookCard, CardGrid } from '../components/Cards'
import { Icon } from '../components/Icon'
import { NetworkScan } from '../components/NetworkScan'
import { useSession } from '../lib/auth'
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

/** Friends › Ask around (#64, #104): your want-to-read list with your network's take on each book, the people most like you first. */
export function WantToReadPage() {
  useDocumentTitle('Ask around')
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
          <p className="kicker">Friends</p>
          <h1>Ask around</h1>
          <p className="lede">
            Your want-to-read list, with what the people you follow made of each book: who loved it, who's reading it and who gave up (and
            where). The readers most like you come first.
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
        <CardGrid size="list" className="asked" label="Your want-to-read list">
          {rows.map((row) => (
            <AskedBook key={row.entry.uri} row={row} />
          ))}
        </CardGrid>
      )}
    </>
  )
}

function AskedBook({ row: { entry, copies, take } }: { row: Row }) {
  const v = entry.value
  const tried = copies.filter((c) => c.entry.value.status !== STATUS.wantToRead)
  const ask = tried.length
    ? askUrl(
        v.title,
        tried.map((c) => c.reader.profile.handle),
        new URL(bookPath(v.hiveId), window.location.origin).href,
      )
    : null
  return (
    <BookCard
      book={{ hiveId: v.hiveId, title: v.title, authors: v.authors, identifiers: v.identifiers, entry }}
      state={{ entry }}
      context={<p className="verdict">{describeTake(take)}</p>}
      action={
        ask ? (
          <a className="btn btn-sm" href={ask} target="_blank" rel="noreferrer">
            <Icon name="chat" size={16} /> Ask them on Bluesky
          </a>
        ) : null
      }
    >
      {copies.length > 0 && (
        <ul className="card-people network-copies">
          {copies.slice(0, 8).map((c) => (
            <NetworkCopyLine key={c.reader.profile.did} copy={c} />
          ))}
        </ul>
      )}
    </BookCard>
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

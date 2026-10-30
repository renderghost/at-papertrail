import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Avatar, Empty, ErrorNote, Loading } from '../components/bits'
import { Cover } from '../components/Cover'
import { NetworkScan } from '../components/NetworkScan'
import { MatchLine } from '../components/Taste'
import { useSession } from '../lib/auth'
import { displayName } from '../lib/format'
import { useDocumentTitle, useMyLibrary } from '../lib/hooks'
import { useNetwork } from '../lib/network'
import { bookPath, profilePath } from '../lib/paths'
import { tasteTwins } from '../lib/taste'

/** Readers most like you (#63): the people you follow, ranked by how alike your reading is. */
export function TwinsPage() {
  useDocumentTitle('Readers like you')
  const { did } = useSession()
  const library = useMyLibrary()
  const network = useNetwork(did)
  const twins = useMemo(() => tasteTwins(library.data ?? [], network.readers, did), [library.data, network.readers, did])

  return (
    <>
      <div className="page-header">
        <div>
          <p className="kicker">Taste twins</p>
          <h1>Readers like you</h1>
          <p className="lede">
            The people you follow, ranked by how alike your reading is: the books you share, how closely your ratings agree, and what you both
            loved or gave up on. Worked out in your browser from public libraries; nothing is stored.
          </p>
        </div>
      </div>

      <NetworkScan network={network} />

      {library.isPending ? (
        <Loading />
      ) : library.isError ? (
        <ErrorNote error={library.error} />
      ) : twins.length === 0 ? (
        network.status === 'loading' ? null : (
          <Empty title="Nobody to compare with yet">
            <p>None of the people you follow share a book with you. Follow a few readers and they'll show up here.</p>
          </Empty>
        )
      ) : (
        <ol className="members twins">
          {twins.map(({ reader, match }) => (
            <li key={reader.profile.did} className="member">
              <Avatar profile={reader.profile} size={44} />
              <div className="body">
                <Link className="name" to={profilePath(reader.profile.handle)}>
                  {displayName(reader.profile)}
                </Link>
                <MatchLine match={match} />
                {match.bothLoved.length > 0 && (
                  <div className="twin-books" aria-label="Books you both loved">
                    {match.bothLoved.slice(0, 6).map((s) => (
                      <Link key={s.mine.uri} to={bookPath(s.mine.value.hiveId)} title={s.mine.value.title}>
                        <Cover hiveId={s.mine.value.hiveId} title={s.mine.value.title} authors={s.mine.value.authors} entry={s.mine} size="xs" />
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}

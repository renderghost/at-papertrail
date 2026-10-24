import { Link, useParams } from 'react-router-dom'
import { Avatar, ErrorNote, Loading } from '../components/bits'
import { Icon } from '../components/Icon'
import { Shelves } from '../components/Shelves'
import { useSession } from '../lib/auth'
import { displayName, plural } from '../lib/format'
import { useLibrary, useProfile } from '../lib/hooks'

/** Anyone's BookHive library, read-only, straight from their PDS. */
export function Profile() {
  const { actor = '' } = useParams()
  const { did } = useSession()
  const profile = useProfile(actor)
  const library = useLibrary(profile.data?.did)

  if (profile.isPending) return <Loading />
  if (profile.isError) return <ErrorNote error={profile.error} />
  const p = profile.data
  const isMe = p.did === did

  return (
    <>
      <div className="page-header">
        <div className="row" style={{ gap: 16, alignItems: 'center' }}>
          <Avatar profile={p} size={72} />
          <div>
            <p className="kicker">{isMe ? 'Your profile' : 'Reader'}</p>
            <h1>{displayName(p)}</h1>
            <p className="muted">
              @{p.handle}
              {library.data ? ` · ${plural(library.data.length, 'book')}` : ''}
            </p>
          </div>
        </div>
        <div className="row">
          {isMe && (
            <Link className="btn" to="/">
              Edit your library
            </Link>
          )}
          <a className="btn btn-quiet" href={`https://bsky.app/profile/${p.handle}`} target="_blank" rel="noreferrer">
            Bluesky <Icon name="external" size={14} />
          </a>
          <a className="btn btn-quiet" href={`https://bookhive.buzz/profile/${p.handle}`} target="_blank" rel="noreferrer">
            BookHive <Icon name="external" size={14} />
          </a>
        </div>
      </div>
      {library.isPending ? (
        <Loading>Reading their shelves…</Loading>
      ) : library.isError ? (
        <ErrorNote error={library.error} />
      ) : (
        <Shelves entries={library.data} emptyMessage={`${displayName(p)} hasn't logged any books on BookHive yet.`} />
      )}
    </>
  )
}

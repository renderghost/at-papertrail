import { useMaybeSession } from '../lib/auth'
import { describeError } from '../lib/errors'
import { useCanWrite, useFollow } from '../lib/usePeople'

/** Follow or unfollow on Bluesky (the follow BookHive uses too). Hidden when signed out or on yourself. */
export function FollowButton({ did, name }: { did: string; name: string }) {
  const me = useMaybeSession()
  const { following, ready, toggle } = useFollow(did)
  const { allowed, reconsent } = useCanWrite('follows')
  if (!me || me.did === did) return null
  if (!allowed) {
    return (
      <button className="btn btn-sm" onClick={reconsent} title="Papertrail needs your permission to follow people. Sign in again to allow it.">
        Follow
      </button>
    )
  }
  return (
    <>
      <button
        className={`btn btn-sm${following ? '' : ' btn-primary'}`}
        disabled={!ready || toggle.isPending}
        aria-pressed={following}
        onClick={() => toggle.mutate()}
        title={following ? `Unfollow ${name}` : `Follow ${name} on Bluesky`}
      >
        {toggle.isPending ? '…' : following ? 'Following' : 'Follow'}
      </button>
      {toggle.isError && (
        <span className="small field-error" role="alert">
          {describeError(toggle.error).message}
        </span>
      )}
    </>
  )
}

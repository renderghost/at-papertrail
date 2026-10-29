import { rkeyOf } from './atproto'
import { procedure, type SessionFetch } from './xrpc'

/**
 * Following readers and authors: a Bluesky follow (`app.bsky.graph.follow`),
 * the same follow BookHive uses, so it shows everywhere.
 */

export const FOLLOW = 'app.bsky.graph.follow'
const APPVIEW = 'https://public.api.bsky.app'

/** The viewer's follow record for `subject`, if any, from the public AppView. */
export async function followUri(viewer: string, subject: string, signal?: AbortSignal): Promise<string | null> {
  const params = new URLSearchParams({ actor: viewer, others: subject })
  const res = await fetch(`${APPVIEW}/xrpc/app.bsky.graph.getRelationships?${params}`, { signal })
  if (!res.ok) throw new Error(`Couldn't check follows (${res.status})`)
  const body = (await res.json()) as { relationships?: { did?: string; following?: string }[] }
  return body.relationships?.find((r) => r.did === subject)?.following ?? null
}

export async function follow(session: SessionFetch, subject: string): Promise<string> {
  const res = await procedure<{ uri: string }>(session, 'com.atproto.repo.createRecord', {
    repo: session.did,
    collection: FOLLOW,
    record: { $type: FOLLOW, subject, createdAt: new Date().toISOString() },
  })
  return res.uri
}

export async function unfollow(session: SessionFetch, uri: string): Promise<void> {
  await procedure(session, 'com.atproto.repo.deleteRecord', { repo: session.did, collection: FOLLOW, rkey: rkeyOf(uri) })
}

/**
 * Authenticated XRPC procedures, sent through the OAuth session's own
 * DPoP-signing fetch handler. The app only writes records (create, put,
 * delete and batches of them), so it doesn't need a full SDK.
 */

export type SessionFetch = {
  did: string
  fetchHandler: (pathname: string, init?: RequestInit) => Promise<Response>
}

export class XrpcError extends Error {
  constructor(
    readonly status: number,
    readonly error: string | undefined,
    message: string,
  ) {
    super(message)
  }
}

export async function procedure<T>(session: SessionFetch, nsid: string, input: unknown): Promise<T> {
  const res = await session.fetchHandler(`/xrpc/${nsid}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string }
  if (!res.ok) throw new XrpcError(res.status, body.error, body.message ?? `${nsid} failed (${res.status})`)
  return body
}

export type Write =
  | { $type: 'com.atproto.repo.applyWrites#create'; collection: string; rkey?: string; value: unknown }
  | { $type: 'com.atproto.repo.applyWrites#update'; collection: string; rkey: string; value: unknown }
  | { $type: 'com.atproto.repo.applyWrites#delete'; collection: string; rkey: string }

export type WriteResult = { uri: string; cid: string }

/** The PDS accepts at most 200 writes per applyWrites call. */
export const MAX_WRITES_PER_CALL = 200

/** Writes in order, 200 per call; one result per write (an empty object for a delete). */
export async function applyWrites(session: SessionFetch, writes: Write[]): Promise<(WriteResult | Record<string, never>)[]> {
  const results: (WriteResult | Record<string, never>)[] = []
  for (let i = 0; i < writes.length; i += MAX_WRITES_PER_CALL) {
    const res = await procedure<{ results?: (WriteResult | Record<string, never>)[] }>(session, 'com.atproto.repo.applyWrites', {
      repo: session.did,
      writes: writes.slice(i, i + MAX_WRITES_PER_CALL),
    })
    results.push(...(res.results ?? []))
  }
  return results
}

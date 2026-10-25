/**
 * Authenticated XRPC procedures, sent through the OAuth session's own
 * DPoP-signing fetch handler. The app makes only three authenticated calls
 * (create, put and delete a record), so it doesn't need a full SDK.
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

import type { Did } from '@atcute/lexicons'
import { isDid, isHandle } from '@atcute/lexicons/syntax'

/** Where handles and DID documents are resolved. */
export const PLC_DIRECTORY = 'https://plc.directory'
export const HANDLE_RESOLVER = 'https://public.api.bsky.app'

export class IdentityError extends Error {
  constructor(
    readonly code: 'InvalidIdentifier' | 'DidNotFound' | 'NoPds',
    message: string,
  ) {
    super(message)
    this.name = 'IdentityError'
  }
}

export type IdentifierCheck =
  | { ok: true; kind: 'did'; value: Did }
  | { ok: true; kind: 'handle'; value: string }
  | { ok: false; message: string }

/** Validates and normalises what someone typed into the sign-in field. */
export function checkIdentifier(raw: string): IdentifierCheck {
  const input = raw.trim().replace(/^@/, '')
  if (!input) return { ok: false, message: 'Enter your handle or DID.' }
  if (input.startsWith('did:')) {
    return isDid(input) ? { ok: true, kind: 'did', value: input } : { ok: false, message: "That doesn't look like a valid DID." }
  }
  const handle = input.toLowerCase()
  if (!handle.includes('.')) {
    return { ok: false, message: 'Handles include a domain, e.g. alice.bsky.social.' }
  }
  return isHandle(handle)
    ? { ok: true, kind: 'handle', value: handle }
    : { ok: false, message: "That doesn't look like a valid handle." }
}

export type DidDocument = {
  id?: unknown
  alsoKnownAs?: unknown
  service?: unknown
}

export function pdsFromDidDocument(doc: DidDocument): string | null {
  if (!Array.isArray(doc.service)) return null
  const svc = doc.service.find(
    (s): s is { id: string; serviceEndpoint: string } =>
      typeof s?.id === 'string' && s.id.endsWith('#atproto_pds') && typeof s.serviceEndpoint === 'string',
  )
  if (!svc || !URL.canParse(svc.serviceEndpoint)) return null
  return svc.serviceEndpoint.replace(/\/+$/, '')
}

export function handleFromDidDocument(doc: DidDocument): string | undefined {
  if (!Array.isArray(doc.alsoKnownAs)) return undefined
  const aka = doc.alsoKnownAs.find((a): a is string => typeof a === 'string' && a.startsWith('at://'))
  return aka?.slice('at://'.length)
}

export function didDocumentUrl(did: string): string {
  if (did.startsWith('did:plc:')) return `${PLC_DIRECTORY}/${did}`
  if (did.startsWith('did:web:')) return `https://${decodeURIComponent(did.slice('did:web:'.length))}/.well-known/did.json`
  throw new IdentityError('InvalidIdentifier', `Unsupported DID method: ${did.split(':')[1]}`)
}

export async function resolveDidDocument(did: string, signal?: AbortSignal): Promise<DidDocument> {
  let res: Response
  try {
    res = await fetch(didDocumentUrl(did), { signal, headers: { accept: 'application/json' } })
  } catch (err) {
    if (signal?.aborted) throw err
    throw new IdentityError('DidNotFound', 'Could not reach the identity directory. Check your connection.')
  }
  if (!res.ok) throw new IdentityError('DidNotFound', `Could not resolve ${did}.`)
  const doc = (await res.json()) as DidDocument
  if (doc.id !== did) throw new IdentityError('DidNotFound', `The DID document does not match ${did}.`)
  return doc
}

const pdsCache = new Map<string, Promise<string>>()

/** Seeds the PDS cache, e.g. from a stored copy; `forgetPds` drops it if it turns out stale. */
export function rememberPds(did: string, pds: string): void {
  if (!pdsCache.has(did)) pdsCache.set(did, Promise.resolve(pds))
}

export function forgetPds(did: string): void {
  pdsCache.delete(did)
}

/** The PDS hosting a DID's repo, e.g. "https://morel.us-east.host.bsky.network". Cached per page load. */
export function resolvePds(did: string): Promise<string> {
  let cached = pdsCache.get(did)
  if (!cached) {
    cached = resolveDidDocument(did).then((doc) => {
      const pds = pdsFromDidDocument(doc)
      if (!pds) throw new IdentityError('NoPds', `${did} has no PDS in its DID document.`)
      return pds
    })
    cached.catch(() => pdsCache.delete(did))
    pdsCache.set(did, cached)
  }
  return cached
}

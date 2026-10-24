import { describe, expect, it } from 'vitest'
import { checkIdentifier, didDocumentUrl, handleFromDidDocument, pdsFromDidDocument } from './identity'

describe('checkIdentifier', () => {
  it('normalises handles: trims, drops a leading @, lower-cases', () => {
    expect(checkIdentifier('  @Alice.BSKY.social ')).toEqual({ ok: true, kind: 'handle', value: 'alice.bsky.social' })
  })

  it('accepts DIDs as typed', () => {
    expect(checkIdentifier('did:plc:ewvi7nxzyoun6zhxrhs64oiz')).toMatchObject({ ok: true, kind: 'did' })
  })

  it('explains what is wrong', () => {
    expect(checkIdentifier('')).toEqual({ ok: false, message: 'Enter your handle or DID.' })
    expect(checkIdentifier('alice')).toEqual({ ok: false, message: 'Handles include a domain, e.g. alice.bsky.social.' })
    expect(checkIdentifier('did:nope')).toMatchObject({ ok: false })
    expect(checkIdentifier('al ice.bsky.social')).toMatchObject({ ok: false })
  })
})

describe('DID documents', () => {
  const doc = {
    id: 'did:plc:abc',
    alsoKnownAs: ['https://example.com', 'at://alice.test'],
    service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.com/' }],
  }

  it('finds the PDS and the claimed handle', () => {
    expect(pdsFromDidDocument(doc)).toBe('https://pds.example.com')
    expect(handleFromDidDocument(doc)).toBe('alice.test')
  })

  it('tolerates missing or malformed fields', () => {
    expect(pdsFromDidDocument({ service: [{ id: '#atproto_pds', serviceEndpoint: 'not a url' }] })).toBeNull()
    expect(pdsFromDidDocument({})).toBeNull()
    expect(handleFromDidDocument({ alsoKnownAs: 'at://x' })).toBeUndefined()
  })

  it('locates plc and web documents', () => {
    expect(didDocumentUrl('did:plc:abc')).toBe('https://plc.directory/did:plc:abc')
    expect(didDocumentUrl('did:web:example.com')).toBe('https://example.com/.well-known/did.json')
    expect(() => didDocumentUrl('did:key:z6Mk')).toThrow(/Unsupported/)
  })
})

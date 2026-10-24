import type { Profile } from '../lib/atproto'
import { getHiveId } from '../lib/bookhive/hiveId'
import { BOOK_COLLECTION, type BookEntry, type BookRecord } from '../lib/bookhive/types'

let counter = 0

export function profile(handle: string): Profile {
  return { did: `did:plc:${handle.replace(/\W/g, '')}`, handle }
}

export function entry(
  owner: Profile | string,
  value: Partial<BookRecord> & { title: string; authors: string },
): BookEntry {
  const did = typeof owner === 'string' ? owner : owner.did
  const rkey = `3k${String(++counter).padStart(11, '0')}`
  return {
    uri: `at://${did}/${BOOK_COLLECTION}/${rkey}`,
    cid: `bafy${counter}`,
    rkey,
    did,
    pds: 'https://pds.example',
    value: {
      hiveId: getHiveId({ title: value.title, authors: value.authors.split('\t')[0]! }),
      createdAt: '2025-01-01T00:00:00.000Z',
      ...value,
    },
  }
}

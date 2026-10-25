import type { Profile } from './atproto'
import { firstAuthor } from './bookhive/authors'
import { STATUS, type BookEntry } from './bookhive/types'
import { bookKey } from './search'

/**
 * Book club: for each book you're reading, the people you follow who are
 * reading it too or have read it before.
 */

export type ClubMember = {
  profile: Profile
  entry: BookEntry
  /** Most recent finish, for people who've read it. */
  finishedAt?: string
}

export type ClubBook = {
  mine: BookEntry
  reading: ClubMember[]
  haveRead: ClubMember[]
}

/** Keys that identify "the same book" across differently-catalogued records. */
export function sameBookKeys(entry: BookEntry): string[] {
  const v = entry.value
  const keys = [`hive:${v.hiveId}`, `title:${bookKey(v.title, firstAuthor(v.authors))}`]
  if (v.identifiers?.isbn13) keys.push(`isbn:${v.identifiers.isbn13}`)
  return keys
}

function lastFinish(entry: BookEntry): string | undefined {
  const v = entry.value
  if (v.status === STATUS.finished && v.finishedAt) return v.finishedAt
  return v.previousReads?.[0]?.finishedAt
}

export function buildBookClub(
  myBooks: BookEntry[],
  readers: { profile: Profile; books: BookEntry[] }[],
): ClubBook[] {
  const index = new Map<string, { profile: Profile; entry: BookEntry }[]>()
  for (const reader of readers) {
    for (const entry of reader.books) {
      for (const key of sameBookKeys(entry)) {
        const list = index.get(key) ?? []
        list.push({ profile: reader.profile, entry })
        index.set(key, list)
      }
    }
  }

  const club = myBooks
    .filter((b) => b.value.status === STATUS.reading)
    .map((mine): ClubBook => {
      const seen = new Set<string>()
      const reading: ClubMember[] = []
      const haveRead: ClubMember[] = []
      for (const key of sameBookKeys(mine)) {
        for (const match of index.get(key) ?? []) {
          if (seen.has(match.profile.did) || match.profile.did === mine.did) continue
          const status = match.entry.value.status
          const finishedAt = lastFinish(match.entry)
          if (status === STATUS.reading) {
            reading.push({ ...match, finishedAt })
          } else if (finishedAt) {
            haveRead.push({ ...match, finishedAt })
          } else {
            continue
          }
          seen.add(match.profile.did)
        }
      }
      haveRead.sort((a, b) => Date.parse(b.finishedAt!) - Date.parse(a.finishedAt!))
      return { mine, reading, haveRead }
    })

  return club.sort(
    (a, b) =>
      b.reading.length + b.haveRead.length - (a.reading.length + a.haveRead.length) ||
      a.mine.value.title.localeCompare(b.mine.value.title),
  )
}

import { describe, expect, it } from 'vitest'
import type { HiveBook } from './bookhive/api'
import { STATUS, type BookEntry, type BookRecord } from './bookhive/types'
import { excluded, isCollection, lovedBy, lovedInNetwork, popularWithTwins, recommendFor, seedsFrom, telling } from './discover'
import { OCCASIONS, pagesPerDay, pickFor, scoreFor, surprise, type Candidate } from './nextRead'
import { tasteTwins } from './taste'

function entry(did: string, title: string, authors: string, value: Partial<BookRecord> = {}): BookEntry {
  const hiveId = `bk_${title.replace(/\W/g, '').toLowerCase()}`
  return {
    uri: `at://${did}/buzz.bookhive.book/${hiveId}`,
    cid: 'c',
    rkey: hiveId,
    did,
    pds: 'https://pds.test',
    value: { title, authors, hiveId, createdAt: '2026-01-01T00:00:00.000Z', status: STATUS.finished, ...value },
  }
}
const hive = (title: string, authors: string, extra: Partial<HiveBook> = {}): HiveBook => ({ id: `bk_${title.replace(/\W/g, '').toLowerCase()}`, title, authors, thumbnail: '', ...extra })

const me = 'did:plc:me'
const mine = [
  entry(me, 'Piranesi', 'Susanna Clarke', { stars: 10, finishedAt: '2026-09-01T00:00:00.000Z' }),
  entry(me, 'Dune', 'Frank Herbert', { stars: 9, finishedAt: '2026-03-01T00:00:00.000Z' }),
  entry(me, 'Station Eleven', 'Emily St. John Mandel', { stars: 7 }),
  entry(me, 'Ulysses', 'James Joyce', { status: STATUS.abandoned }),
]

describe('because you loved', () => {
  it('seeds from your four-and-a-half and five-star books, newest first', () => {
    expect(seedsFrom(mine).map((e) => e.value.title)).toEqual(['Piranesi', 'Dune'])
    expect(telling(['Fiction', 'Audiobook', 'Fantasy', 'Mystery'])).toBe('Fantasy')
    for (const t of ['The Earthsea Quartet', 'Earthsea Series Books 1-4 - A Wizard of Earthsea', 'The Complete Stories', 'Dune Box Set']) expect(isCollection(t)).toBe(true)
    for (const t of ['The Tombs of Atuan', 'Book of the New Sun', 'The Collector']) expect(isCollection(t)).toBe(false)
  })

  it('picks from people most like you, the author and the genre, saying why, never what you have', () => {
    const twinBooks = [
      // Her best-rated books are ones you have: her favourite you don't is further down.
      entry('did:plc:erin', 'Piranesi', 'Susanna Clarke', { stars: 10 }),
      entry('did:plc:erin', 'Piranesi', 'Susanna Clarke', { stars: 10 }),
      entry('did:plc:erin', 'Piranesi', 'Susanna Clarke', { stars: 10 }),
      entry('did:plc:erin', 'Dune', 'Frank Herbert', { stars: 9 }),
      entry('did:plc:erin', 'Station Eleven', 'Emily St. John Mandel', { stars: 7 }),
      entry('did:plc:erin', 'The Starless Sea', 'Erin Morgenstern', { stars: 10 }),
      entry('did:plc:erin', 'Ulysses', 'James Joyce', { status: STATUS.abandoned }),
    ]
    const twins = tasteTwins(mine, [{ profile: { did: 'did:plc:erin', handle: 'erin.test', displayName: 'Erin Vale' }, books: twinBooks }], me)
    const byAuthor = [
      hive('Piranesi', 'Susanna Clarke', { ratingsCount: 400000 }),
      hive('Jonathan Strange & Mr Norrell', 'Susanna Clarke', { ratingsCount: 300000 }),
      hive('Jonathan Strange and Mr Norrell: A Novel', 'Susanna Clarke', { ratingsCount: 299000 }),
      hive('The Ladies of Grace Adieu', 'Susanna Clarke', { ratingsCount: 30000 }),
    ]
    const genre = { name: 'Fantasy', books: [hive('The Night Circus', 'Erin Morgenstern', { ratingsCount: 900000 }), hive('The Starless Sea', 'Erin Morgenstern', { ratingsCount: 200000 })] }
    const picks = recommendFor(mine[0]!, { byAuthor, genre }, twins, excluded(mine, ['bk_theladiesofgraceadieu']), { reader: 'English' })
    expect(picks.map((p) => [p.title, p.why])).toEqual([
      ['The Starless Sea', 'Erin Vale (98% match) loved Piranesi too, and gave this 5 stars'],
      ['Jonathan Strange & Mr Norrell', 'Because you gave Piranesi 5 stars: more from Susanna Clarke'],
      ['The Night Circus', 'Because you loved Piranesi: among the most-read fantasy on BookHive'],
    ])
  })
})

describe('pick my next read', () => {
  const want = (title: string, catalog: Partial<HiveBook>, value: Partial<BookRecord> = {}, networkAverage?: number): Candidate => ({
    entry: entry(me, title, 'Someone', { status: STATUS.wantToRead, ...value }),
    catalog: hive(title, 'Someone', catalog),
    ...(networkAverage ? { networkAverage } : {}),
  })
  const shelf = [
    want('Doorstop', { numPages: 1100, genres: ['Fantasy'] }),
    want('Gripping Thriller', { numPages: 380, genres: ['Thriller', 'Mystery'] }),
    want('Series Book Three', { numPages: 350, genres: ['Thriller'], series: JSON.stringify({ title: 'A Series', position: '3' }) }),
    want('Slim Novella', { numPages: 120, genres: ['Literary Fiction'] }, { owned: true }),
    want('Beach Romance', { numPages: 320, genres: ['Romance', 'Contemporary'] }),
    want('Horror Night', { numPages: 300, genres: ['Horror', 'Thriller'] }),
  ]
  const occasion = (id: string) => OCCASIONS.find((o) => o.id === id)!

  it('finds a gripping standalone for a long flight, and says why', () => {
    const [best] = pickFor(shelf, occasion('flight')).picks
    expect(best!.candidate.entry.value.title).toBe('Gripping Thriller')
    expect(best!.why).toEqual(['380 pages, about 8 hours', 'thriller and mystery', 'a standalone'])
  })

  it('keeps tense books away from bedtime and suits each occasion', () => {
    expect(pickFor(shelf, occasion('bed')).picks.map((p) => p.candidate.entry.value.title)).not.toContain('Horror Night')
    expect(pickFor(shelf, occasion('beach')).picks[0]!.candidate.entry.value.title).toBe('Beach Romance')
    expect(pickFor(shelf, occasion('train')).picks[0]!.candidate.entry.value.title).toBe('Slim Novella')
    expect(scoreFor(shelf[3]!, occasion('commute'), { ownedFirst: true }).why).toContain('you own it')
  })

  it('packs a holiday to fit your pace', () => {
    const { picks, note } = pickFor(shelf, occasion('holiday'), { pace: 80 })
    const pages = picks.reduce((n, p) => n + (p.candidate.catalog?.numPages ?? 0), 0)
    expect(pages).toBeLessThanOrEqual(80 * 14 * 1.15)
    expect(note).toMatch(/^\d books, about [\d,]+ pages: two weeks at your pace of 80 pages a day$/)
  })

  it('learns your pace from finished books, and surprises you fairly', () => {
    const done = (pages: number, days: number) => ({ entry: entry(me, `B${pages}`, 'A', { startedAt: '2026-01-01T00:00:00.000Z', finishedAt: new Date(Date.parse('2026-01-01') + days * 86_400_000).toISOString() }), pages })
    expect(pagesPerDay([done(300, 10), done(200, 4), done(400, 5), { entry: mine[0]!, pages: 272 }])).toBe(50)
    expect(pagesPerDay([])).toBe(30)
    expect(surprise(shelf, () => 0)?.entry.value.title).toBe('Doorstop')
    expect(surprise([], () => 0.5)).toBeNull()
  })
})

describe('recommendations', () => {
  // Three books you have, rated by each reader: Piranesi, Dune, Station Eleven.
  const shared = (did: string, [a, b, c]: number[]) => [
    entry(did, 'Piranesi', 'Susanna Clarke', { stars: a }),
    entry(did, 'Dune', 'Frank Herbert', { stars: b }),
    entry(did, 'Station Eleven', 'Emily St. John Mandel', { stars: c }),
  ]
  const reader = (name: string, stars: number[], books: [string, string, Partial<BookRecord>][]) => {
    const did = `did:plc:${name.toLowerCase()}`
    return { profile: { did, handle: `${name.toLowerCase()}.test`, displayName: name }, books: [...shared(did, stars), ...books.map(([t, a, v]) => entry(did, t, a, v))] }
  }
  const erin = reader('Erin', [10, 9, 7], [
    ['The Starless Sea', 'Erin Morgenstern', { stars: 10 }],
    ['Circe', 'Madeline Miller', { stars: 8 }],
    ['The Hobbit', 'J. R. R. Tolkien', { stars: 10 }],
    ['Middlemarch', 'George Eliot', { stars: 9 }],
    ['Beloved', 'Toni Morrison', { stars: 9 }],
    ['The Earthsea Quartet', 'Ursula K. Le Guin', { stars: 10 }],
    ['Dracula', 'Bram Stoker', { stars: 9, status: STATUS.abandoned }],
  ])
  const finn = reader('Finn', [9, 9, 6], [
    ['The Starless Sea', 'Erin Morgenstern', { stars: 9 }],
    ['Circe', 'Madeline Miller', { stars: 9 }],
    ['Gideon the Ninth', 'Tamsyn Muir', { stars: 6 }],
  ])
  // Rates everything you love low: not like you at all.
  const gus = reader('Gus', [2, 2, 10], [
    ['The Martian', 'Andy Weir', { stars: 9, finishedAt: '2026-06-01T00:00:00.000Z' }],
    ['The Da Vinci Code', 'Dan Brown', { stars: 10, finishedAt: '2024-05-01T00:00:00.000Z' }],
  ])
  const twins = tasteTwins(mine, [gus, finn, erin], me)
  const score = (did: string) => twins.find((t) => t.reader.profile.did === did)!.match.score!

  it('ranks what the readers most like you loved, the more of them the higher, never what you have', () => {
    expect(score('did:plc:gus')).toBeLessThan(60)
    const picks = popularWithTwins(twins, excluded(mine, []), { perReader: 2 })
    // Two readers like you loved the first two; then one reader's favourites, two at most;
    // never a box set, a book they gave up on, or anything from someone unlike you.
    expect(picks.map((p) => p.book.value.title)).toEqual(['The Starless Sea', 'Circe', 'The Hobbit', 'Middlemarch'])
    expect(lovedBy(picks[0]!)).toBe(`Loved by Erin (${score('did:plc:erin')}% match) and 1 other`)
    expect(lovedBy(picks[2]!)).toBe(`Loved by Erin (${score('did:plc:erin')}% match)`)
  })

  it('leaves out what you waved away', () => {
    const picks = popularWithTwins(twins, excluded(mine, ['bk_thestarlesssea']))
    expect(picks.map((p) => p.book.value.title)).not.toContain('The Starless Sea')
  })

  it('then what anyone you follow loved lately, that the first list didn’t have', () => {
    const skip = excluded(mine, [])
    for (const p of popularWithTwins(twins, skip)) skip.add(`hive:${p.book.value.hiveId}`)
    const loved = lovedInNetwork([gus, finn, erin, reader('Me', [10, 9, 7], [['Mine', 'Me', { stars: 10 }]])], skip, { myDid: 'did:plc:me', since: '2025-10-30T00:00:00.000Z' })
    expect(loved.map((p) => [p.book.value.title, lovedBy(p)])).toEqual([['The Martian', 'Loved by Gus']])
  })
})

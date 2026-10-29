import { describe, expect, it } from 'vitest'
import { STATUS } from '../bookhive/types'
import { bareTitle, ImportFileError, isbnsFrom, parseDatesRead, parseExport, parseExportDate, plainReview, toStars } from './sources'

const GOODREADS = `Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies
209439446,"Onyx Storm (The Empyrean, #3)",Rebecca Yarros,"Yarros, Rebecca",,"=""1649374186""","=""9781649374189""",0,4.23,Red Tower Books,Hardcover,527,2025,2025,,2024/07/31,currently-reading,currently-reading (#1),currently-reading,,,,1,0
52694527,"The Shadow of the Gods (The Bloodsworn Saga, #1)",John Gwynne,"Gwynne, John",,"=""0356514188""","=""9780356514185""",4,4.21,Orbit,Hardcover,480,2021,2021,2025/05/12,2025/04/15,"fantasy, favourites","fantasy (#3), favourites (#1)",read,"Loved it.<br/><br/>Brutal &amp; brilliant.",true,,2,1
1,Middlemarch,George Eliot,"Eliot, George",,"=""""","=""""",0,3.98,,,,,,,2023/01/02,"dnf, classics",,to-read,,,,0,0
2,,No Title,,,,,,,,,,,,,,,,,,,,,
`

const STORYGRAPH = `Title,Authors,Contributors,ISBN/UID,Format,Read Status,Date Added,Last Date Read,Dates Read,Read Count,Moods,Pace,Character- or Plot-Driven?,Strong Character Development?,Loveable Characters?,Diverse Characters?,Flawed Characters?,Star Rating,Review,Content Warnings,Content Warning Description,Tags,Owned?
Old Man's War,John Scalzi,,9780765348272,paperback,read,2025/01/10,2025/02/15,"2021/03/01-2021/03/20, 2025/02/01-2025/02/15",2,"adventurous, funny",fast,,,,,,4.25,Great fun,Violence,,"sci-fi, re-reads",Yes
The Tombs of Atuan,Ursula K. Le Guin,Gail Garraty (Illustrator),9780689845369,paperback,currently-reading,2025/03/01,,"2025/03/02-",1,,,,,,,,,,,,,No
Infinite Jest,David Foster Wallace,,a1b2c3d4e5,paperback,did-not-finish,2024/06/01,,2024/06/02-2024/07/10,1,,,,,,,,1.75,,,,,No
`

const HARDCOVER = `Title,Author,Series,Status,Privacy,Hardcover Book ID,Hardcover Edition ID,ISBN 10,ISBN 13,ASIN,Media,Country Code,Language Code,Binding,Pages,Duration in Seconds,Publish Date,Publisher,Genres,Moods,Tags,Content Warnings,Lists,Date Added,Date Started,Date Finished,Rating,Review,Review Contains Spoilers,Sponsored Review,Review Date,Review URL,Review Media URL,Private Notes,Owned,Compilation,Review Slate
2666,"Roberto Bolaño, Natasha Wimmer (Translator)",2666 (#1.0),Stopped,Public,75726,25012766,0374100144,9780374100148,0374100144,Book,us,en,,898,,2008-11-11,FSG,,,,,"",2025-01-15,2025-01-16,"",,,false,false,,,,,false,No,{}
Burning Chrome,William Gibson,Sprawl (#0.0),Read,Public,2440,31159321,,,B0036G94XY,Audio,us,en,,191,25686,1986-04-01,Audible,,dark,,,"Owned, Cyberpunk Shelf (#19)",2025-01-10,2025-01-01,2025-01-23,4.5,"Sharp.",true,false,,,,,true,No,{}
`

describe('helpers', () => {
  it('reads export dates as midnight UTC, rejecting impossible ones', () => {
    expect(parseExportDate('2024/12/15')).toBe('2024-12-15T00:00:00.000Z')
    expect(parseExportDate('2025-01-23')).toBe('2025-01-23T00:00:00.000Z')
    expect(parseExportDate('2025-01-15T13:56:31Z')).toBe('2025-01-15T00:00:00.000Z')
    expect(parseExportDate('2025/02/30')).toBeUndefined()
    expect(parseExportDate('')).toBeUndefined()
  })

  it('rounds quarter stars to the nearest half, and says so', () => {
    expect(toStars('4')).toEqual({ stars: 8, rounded: false })
    expect(toStars('4.5')).toEqual({ stars: 9, rounded: false })
    expect(toStars('4.25')).toEqual({ stars: 9, rounded: true })
    expect(toStars('1.75')).toEqual({ stars: 4, rounded: true })
    expect(toStars('0')).toEqual({ rounded: false })
    expect(toStars('')).toEqual({ rounded: false })
  })

  it('cleans ISBNs, including Goodreads\' ="…" wrapping, and ignores other ids', () => {
    expect(isbnsFrom('="9781649374189"', '="1649374186"')).toEqual({ isbn13: '9781649374189', isbn10: '1649374186' })
    expect(isbnsFrom('a1b2c3d4e5', '="')).toEqual({})
    expect(isbnsFrom('978-0-7653-4827-2')).toEqual({ isbn13: '9780765348272' })
  })

  it('strips a series suffix the way Goodreads bare titles do', () => {
    expect(bareTitle('Onyx Storm (The Empyrean, #3)')).toBe('Onyx Storm')
    expect(bareTitle('The Wee Free Men (Discworld, #30; Tiffany Aching, #1)')).toBe('The Wee Free Men')
    expect(bareTitle('Dune (Dune, #1-3)')).toBe('Dune')
    expect(bareTitle('Persuasion (Annotated)')).toBe('Persuasion (Annotated)')
  })

  it('turns review HTML into plain text', () => {
    expect(plainReview('Loved it.<br/><br/>Brutal &amp; brilliant.')).toBe('Loved it.\n\nBrutal & brilliant.')
    expect(plainReview('<p>One</p><p>Two</p>')).toBe('One\n\nTwo')
    expect(plainReview('  ')).toBeUndefined()
  })

  it('reads StoryGraph date ranges, open ranges and single dates, newest first', () => {
    expect(parseDatesRead('2021/03/01-2021/03/20, 2025/02/01-2025/02/15')).toEqual([
      { startedAt: '2025-02-01T00:00:00.000Z', finishedAt: '2025-02-15T00:00:00.000Z' },
      { startedAt: '2021-03-01T00:00:00.000Z', finishedAt: '2021-03-20T00:00:00.000Z' },
    ])
    expect(parseDatesRead('2025/03/02-')).toEqual([{ startedAt: '2025-03-02T00:00:00.000Z' }])
    expect(parseDatesRead('2019/05/01')).toEqual([{ finishedAt: '2019-05-01T00:00:00.000Z' }])
    expect(parseDatesRead('')).toEqual([])
  })
})

describe('parseExport', () => {
  it('reads a Goodreads export', () => {
    const { source, rows, skipped } = parseExport(GOODREADS)
    expect(source).toBe('goodreads')
    expect(skipped).toBe(1)
    const [onyx, shadow, middlemarch] = rows
    expect(onyx).toMatchObject({
      line: 2,
      title: 'Onyx Storm (The Empyrean, #3)',
      bareTitle: 'Onyx Storm',
      authors: ['Rebecca Yarros'],
      isbn13: '9781649374189',
      isbn10: '1649374186',
      goodreadsId: '209439446',
      status: STATUS.reading,
      createdAt: '2024-07-31T00:00:00.000Z',
      owned: false,
      shelves: [],
    })
    expect(onyx!.stars).toBeUndefined()
    expect(shadow).toMatchObject({
      status: STATUS.finished,
      finishedAt: '2025-05-12T00:00:00.000Z',
      stars: 8,
      review: 'Loved it.\n\nBrutal & brilliant.',
      owned: true,
      shelves: ['fantasy', 'favourites'],
      extras: { spoiler: true, undatedRereads: 1 },
    })
    // A DNF shelf wins over the exclusive shelf, and isn't offered as a list.
    expect(middlemarch).toMatchObject({ status: STATUS.abandoned, shelves: ['classics'] })
    expect(middlemarch!.isbn13).toBeUndefined()
  })

  it('reads a StoryGraph export, with re-reads, open reads and DNFs', () => {
    const { source, rows } = parseExport(STORYGRAPH)
    expect(source).toBe('storygraph')
    const [war, tombs, jest] = rows
    expect(war).toMatchObject({
      status: STATUS.finished,
      startedAt: '2025-02-01T00:00:00.000Z',
      finishedAt: '2025-02-15T00:00:00.000Z',
      previousReads: [{ startedAt: '2021-03-01T00:00:00.000Z', finishedAt: '2021-03-20T00:00:00.000Z' }],
      stars: 9,
      ratingRounded: true,
      owned: true,
      shelves: ['sci-fi', 're-reads'],
      extras: { moods: true, pace: true, contentWarnings: true, undatedRereads: 0 },
    })
    expect(tombs).toMatchObject({ status: STATUS.reading, startedAt: '2025-03-02T00:00:00.000Z', previousReads: [], authors: ['Ursula K. Le Guin'] })
    expect(tombs!.finishedAt).toBeUndefined()
    // The abandoned attempt keeps its start, and isn't recorded as a finished read.
    expect(jest).toMatchObject({ status: STATUS.abandoned, startedAt: '2024-06-02T00:00:00.000Z', previousReads: [], stars: 4 })
    expect(jest!.finishedAt).toBeUndefined()
    expect(jest!.isbn10).toBeUndefined()
  })

  it('reads a Hardcover export', () => {
    const { source, rows } = parseExport(HARDCOVER)
    expect(source).toBe('hardcover')
    const [novel, chrome] = rows
    expect(novel).toMatchObject({
      authors: ['Roberto Bolaño'],
      status: STATUS.abandoned,
      startedAt: '2025-01-16T00:00:00.000Z',
      isbn10: '0374100144',
      isbn13: '9780374100148',
      owned: false,
    })
    expect(chrome).toMatchObject({
      status: STATUS.finished,
      startedAt: '2025-01-01T00:00:00.000Z',
      finishedAt: '2025-01-23T00:00:00.000Z',
      stars: 9,
      review: 'Sharp.',
      owned: true,
      shelves: ['Cyberpunk Shelf'],
      extras: { moods: true, spoiler: true },
    })
  })

  it('says what is wrong with a file it cannot read', () => {
    expect(() => parseExport('Name,Email\nA,b@c')).toThrow(ImportFileError)
    expect(() => parseExport('not a csv')).toThrow(/isn't a CSV export/)
    expect(() => parseExport(GOODREADS.split('\n')[0]!)).toThrow(/has no books/)
  })
})

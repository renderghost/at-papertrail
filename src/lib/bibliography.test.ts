import { describe, expect, it } from 'vitest'
import { bestEdition, distinctWorks, editionFor, groupBibliography, inLanguage, isBy, mainLanguage, mergeEditions, readerLanguage, seriesOrder, seriesSlots, workGroups, workKey } from './bibliography'

describe('bibliography', () => {
  it('treats editions of one work as one', () => {
    expect(workKey('Jonathan Strange & Mr. Norrell: A Novel')).toBe(workKey('Jonathan Strange and Mr Norrell by Susanna Clarke'))
    const merged = mergeEditions([
      { title: 'Jonathan Strange & Mr Norrell', ratingsCount: 300 },
      { title: 'Piranesi', ratingsCount: 400 },
      { title: 'Jonathan Strange & Mr. Norrell: A Novel', ratingsCount: 9000 },
    ])
    expect(merged.map((b) => b.title)).toEqual(['Piranesi', 'Jonathan Strange & Mr. Norrell: A Novel'])
  })

  it('groups series in reading order and lists the rest newest first', () => {
    const s = (title: string, position: string) => JSON.stringify({ title, position })
    const { series, standalone } = groupBibliography([
      { title: 'Two', series: s('Earthsea', '2') },
      { title: 'Old', publicationYear: 1971 },
      { title: 'One', series: s('Earthsea', '1') },
      { title: 'New', publicationYear: 2001 },
    ])
    expect(series).toEqual([{ series: 'Earthsea', books: [expect.objectContaining({ title: 'One' }), expect.objectContaining({ title: 'Two' })] }])
    expect(standalone.map((b) => b.title)).toEqual(['New', 'Old'])
  })

  it('picks the plainest title among editions Goodreads rates as one work', () => {
    // Real shapes from Le Guin's BookHive listing: ratings are per work, so editions differ by a whisker.
    const editions = [
      { title: 'The Dispossessed by Le Guin, Ursula K. ( Author ) ON Aug-12-', ratingsCount: 165225 },
      { title: 'The Dispossessed', ratingsCount: 165069 },
    ]
    expect(bestEdition(editions).title).toBe('The Dispossessed')
    expect(mergeEditions(editions).map((b) => b.title)).toEqual(['The Dispossessed'])
    // A real gap in ratings still wins, and a preference narrows the field first.
    expect(bestEdition([{ title: 'Dune', ratingsCount: 10 }, { title: 'Dune: Deluxe', ratingsCount: 9000 }]).title).toBe('Dune: Deluxe')
    expect(bestEdition(editions, (b) => b.title.includes('Author')).title).toMatch(/Author/)
  })

  it('reads series positions strictly: box sets are not book 1', () => {
    expect(seriesOrder('3')).toBe(3)
    expect(seriesOrder('1.5')).toBe(1.5)
    expect(seriesOrder('1-4')).toBe(Number.POSITIVE_INFINITY)
    expect(seriesOrder(undefined)).toBe(Number.POSITIVE_INFINITY)
  })

  it('puts reprints and translations of one place in a series together', () => {
    const s = (position?: string) => JSON.stringify({ title: 'Earthsea Cycle', ...(position ? { position } : {}) })
    const slots = seriesSlots([
      { title: 'A Wizard of Earthsea', series: s('1') },
      { title: 'Le sorcier de Terremer', series: s('1') },
      { title: 'The Tombs of Atuan', series: s('2') },
      { title: 'The Earthsea Quartet', series: s('1-4') },
      { title: 'Earthsea: The First Four Books', series: s('1-4') },
      { title: 'The Earthsea Trilogy', series: s('1-3') },
      { title: 'Earthsea Companion', series: s() },
    ])
    expect(slots.map((slot) => slot.map((b) => b.title))).toEqual([
      ['A Wizard of Earthsea', 'Le sorcier de Terremer'],
      ['The Tombs of Atuan'],
      ['The Earthsea Quartet', 'Earthsea: The First Four Books'],
      ['The Earthsea Trilogy'],
      ['Earthsea Companion'],
    ])
  })

  it("prefers the reader's language, then the series' own, then an edition with none recorded", () => {
    expect(readerLanguage(['fr-FR', 'en'])).toBe('French')
    expect(readerLanguage(['not a tag!', 'en-GB'])).toBe('English')
    expect(inLanguage({ language: 'Spanish; Castilian' }, 'Spanish')).toBe(true)
    expect(mainLanguage([{ language: 'English' }, { language: 'English' }, { language: 'Spanish; Castilian' }, {}])).toBe('English')
    const editions = [
      { title: 'Čaroděj Zeměmoří', language: 'Czech', ratingsCount: 378310 },
      { title: 'A Wizard of Earthsea', ratingsCount: 379765 },
      { title: 'Le sorcier de Terremer', language: 'French', ratingsCount: 379268 },
    ]
    expect(editionFor(editions, ['French', 'English']).title).toBe('Le sorcier de Terremer')
    // Neither Japanese nor English recorded: the edition without a language beats the shorter Czech title.
    expect(editionFor(editions, ['Japanese', 'English']).title).toBe('A Wizard of Earthsea')
    // The title most editions share wins over a shorter misspelling (real Hainish Cycle book 6 editions).
    const hainish6 = [
      { title: 'The Dispossed', language: 'English', ratingsCount: 165000 },
      { title: 'The Dispossessed', language: 'English', ratingsCount: 165069 },
      { title: 'The Dispossessed by Le Guin, Ursula K. ( Author ) ON Aug-12-', language: 'English', ratingsCount: 165225 },
    ]
    expect(editionFor(hainish6, ['English']).title).toBe('The Dispossessed')
  })

  it('leaves a work out of the other books when any edition of it is in a series', () => {
    const s = JSON.stringify({ title: 'Earthsea Cycle', position: '4' })
    const { series, standalone } = groupBibliography(
      [
        { title: 'Tehanu: Book Four (Earthsea Cycle) by Ursula K. Le Guin', ratingsCount: 63176 },
        { title: 'Tehanu', series: s, ratingsCount: 63114 },
        { title: 'Lavinia', ratingsCount: 20000 },
        { title: 'Lavinia: A Novel', ratingsCount: 19990 },
      ],
      'English',
    )
    expect(series[0]!.books.map((b) => b.title)).toEqual(['Tehanu'])
    expect(standalone.map((b) => b.title)).toEqual(['Lavinia'])
  })

  it('shows one edition per place in a series, in your language, box sets last', () => {
    const s = (position: string) => JSON.stringify({ title: 'Earthsea Cycle', position })
    const { series } = groupBibliography(
      [
        { title: 'Las tumbas de Atuan', series: s('2'), language: 'Spanish; Castilian', ratingsCount: 142800 },
        { title: 'The Earthsea Quartet', series: s('1-4'), language: 'English', ratingsCount: 13484 },
        { title: 'The Tombs of Atuan', series: s('2'), language: 'English', ratingsCount: 142704 },
        { title: 'A Wizard of Earthsea', series: s('1'), language: 'English', ratingsCount: 379765 },
      ],
      'English',
    )
    expect(series[0]!.books.map((b) => b.title)).toEqual(['A Wizard of Earthsea', 'The Tombs of Atuan', 'The Earthsea Quartet'])
  })

  it('finds editions of one work across titles and languages by their shared ratings count', () => {
    // Real shapes from BookHive's Fantasy genre listing.
    const books = [
      { title: "Harry Potter and the Philosopher's Stone", authors: 'J.K. Rowling', language: 'English', ratingsCount: 11891491 },
      { title: "Harry Potter and the Sorcerer's Stone", authors: 'J.K. Rowling', language: 'English', ratingsCount: 11889183 },
      { title: 'Harry Potter e la pietra filosofale', authors: 'J.K. Rowling', language: 'Italian', ratingsCount: 11839375 },
      { title: "Harry Potter and the Philosopher's Stone", authors: 'J.K. Rowling', language: 'English', ratingsCount: 11890416 },
      { title: 'Harry Potter and the Chamber of Secrets', authors: 'J.K. Rowling', language: 'English', ratingsCount: 4600000 },
      { title: 'The Hobbit', authors: 'J.R.R. Tolkien', language: 'English', ratingsCount: 4590000 },
      { title: 'Small Press Poems', authors: 'Jo Bloggs', ratingsCount: 12 },
      { title: 'Other Small Poems', authors: 'Jo Bloggs', ratingsCount: 12 },
    ]
    expect(workGroups(books).map((g) => g.length)).toEqual([4, 1, 1, 1, 1])
    expect(distinctWorks(books, 'English').map((b) => b.title)).toEqual([
      "Harry Potter and the Philosopher's Stone",
      'Harry Potter and the Chamber of Secrets',
      'The Hobbit',
      'Small Press Poems',
      'Other Small Poems',
    ])
    expect(distinctWorks(books, 'Italian')[0]!.title).toBe('Harry Potter e la pietra filosofale')
  })

  it('matches any credited author', () => {
    expect(isBy('Neil Gaiman\tTerry Pratchett', 'terry pratchett')).toBe(true)
    expect(isBy('Ursula K. Le Guin', 'Ursula K Le Guin')).toBe(true)
    expect(isBy('Frank Herbert', 'Brian Herbert')).toBe(false)
  })
})

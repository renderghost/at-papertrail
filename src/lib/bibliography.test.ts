import { describe, expect, it } from 'vitest'
import { groupBibliography, isBy, mergeEditions, workKey } from './bibliography'

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

  it('matches any credited author', () => {
    expect(isBy('Neil Gaiman\tTerry Pratchett', 'terry pratchett')).toBe(true)
    expect(isBy('Ursula K. Le Guin', 'Ursula K Le Guin')).toBe(true)
    expect(isBy('Frank Herbert', 'Brian Herbert')).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { cleanIsbn, isBooklandEan, isbn10To13, isbn13To10, isbnKeys, parseIsbn } from './isbn'

describe('isbn', () => {
  it('converts between ISBN-13 and ISBN-10', () => {
    expect(isbn13To10('9780593135204')).toBe('0593135202')
    expect(isbn13To10('978-0-8044-2957-3')).toBe('080442957X')
    expect(isbn10To13('0593135202')).toBe('9780593135204')
    expect(isbn10To13('080442957X')).toBe('9780804429573')
  })

  it('has no ISBN-10 for 979 prefixes or malformed input', () => {
    expect(isbn13To10('9798721503788')).toBeNull()
    expect(isbn13To10('12345')).toBeNull()
    expect(isbn10To13('123')).toBeNull()
  })

  it('cleans punctuation and normalises X', () => {
    expect(cleanIsbn(' 0-8044-2957-x ')).toBe('080442957X')
  })

  it('lists every spelling for matching', () => {
    expect(isbnKeys({ isbn13: '9780593135204' }).sort()).toEqual(['0593135202', '9780593135204'])
    expect(isbnKeys({ isbn10: '0593135202' }).sort()).toEqual(['0593135202', '9780593135204'])
    expect(isbnKeys(undefined)).toEqual([])
  })
})

describe('isBooklandEan and parseIsbn', () => {
  it('accepts only book barcodes with a valid check digit', () => {
    expect(isBooklandEan('9780441013593')).toBe(true)
    expect(isBooklandEan('9780441013594')).toBe(false)
    // A grocery EAN-13 isn't a book.
    expect(isBooklandEan('5012345678900')).toBe(false)
  })

  it('reads typed ISBNs of either length', () => {
    expect(parseIsbn('978-0-441-01359-3')).toBe('9780441013593')
    expect(parseIsbn('0441013597')).toBe('9780441013593')
    expect(parseIsbn('0 8044 2957 X')).toBe('9780804429573')
    expect(parseIsbn('0441013598')).toBeNull()
    expect(parseIsbn('dune')).toBeNull()
  })
})

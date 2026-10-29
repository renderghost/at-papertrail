import { describe, expect, it } from 'vitest'
import { csvRecords, parseCsv, toCsv } from './csv'

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, commas and line breaks inside fields', () => {
    expect(parseCsv('a,"b, c","say ""hi""","two\nlines"\r\nd,e,f,g\n')).toEqual([
      ['a', 'b, c', 'say "hi"', 'two\nlines'],
      ['d', 'e', 'f', 'g'],
    ])
  })

  it('skips a byte-order mark and blank lines, and keeps empty fields', () => {
    expect(parseCsv('﻿Title,Author\n\nDune,,\n')).toEqual([
      ['Title', 'Author'],
      ['Dune', '', ''],
    ])
  })

  it('treats a stray quote mid-field as a character', () => {
    expect(parseCsv('5" floppy,ok')).toEqual([['5" floppy', 'ok']])
  })

  it('reads a last row without a newline, and an empty quoted field', () => {
    expect(parseCsv('a,""')).toEqual([['a', '']])
  })
})

describe('csvRecords', () => {
  it('keys rows by trimmed headers', () => {
    expect(csvRecords(' Title ,Author\nDune, Frank Herbert \n')).toEqual({
      headers: ['Title', 'Author'],
      rows: [{ Title: 'Dune', Author: 'Frank Herbert' }],
    })
  })
})

describe('toCsv', () => {
  it('quotes only where needed and round-trips', () => {
    const rows = [['Title', 'Note'], ['Dune', 'a, b'], ['="0441013597"', 'He said "go"'], ['x', ' padded']]
    const text = toCsv(rows)
    expect(text).toBe('Title,Note\r\nDune,"a, b"\r\n"=""0441013597""","He said ""go"""\r\nx," padded"\r\n')
    expect(parseCsv(text)).toEqual(rows)
  })
})

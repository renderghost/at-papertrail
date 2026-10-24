import { describe, expect, it } from 'vitest'
import { formFromRecord, recordFromForm } from './edit'
import { applyPatch } from './library'
import { BOOK_COLLECTION, STATUS, type BookRecord } from './types'

const NOW = '2025-06-01T12:00:00.000Z'
const now = () => NOW

const base: BookRecord = {
  $type: BOOK_COLLECTION,
  title: 'Piranesi',
  authors: 'Susanna Clarke',
  hiveId: 'bk_abc',
  createdAt: '2025-01-01T00:00:00.000Z',
  status: STATUS.reading,
  startedAt: '2025-05-01T00:00:00.000Z',
  // Written by another client; must survive an edit made here.
  cover: { $type: 'blob', ref: { $link: 'bafkrei' }, mimeType: 'image/jpeg', size: 1 },
  somethingNew: { from: 'a future BookHive' },
}

function edit(record: BookRecord, changes: Partial<ReturnType<typeof formFromRecord>>) {
  const result = recordFromForm(record, { ...formFromRecord(record), ...changes }, now)
  if ('error' in result) throw new Error(result.error)
  return result.record
}

describe('applyPatch', () => {
  it('removes null fields and keeps unknown ones', () => {
    const next = applyPatch({ ...base, stars: 8 }, { stars: null, review: 'Lovely' })
    expect(next.stars).toBeUndefined()
    expect(next.review).toBe('Lovely')
    expect(next.somethingNew).toEqual({ from: 'a future BookHive' })
  })
})

describe('recordFromForm', () => {
  it('saving an unchanged form changes nothing', () => {
    expect(edit(base, {})).toEqual(base)
  })

  it('finishing a book stamps today and keeps the start date', () => {
    const next = edit(base, { status: STATUS.finished, stars: 9 })
    expect(next).toMatchObject({ status: STATUS.finished, startedAt: base.startedAt, finishedAt: NOW, stars: 9 })
    expect(next.cover).toEqual(base.cover)
  })

  it('clearing a date field removes the date', () => {
    expect(edit(base, { startedAt: '' }).startedAt).toBeUndefined()
  })

  it('records progress with a timestamp and derives the percent from pages', () => {
    expect(edit(base, { currentPage: '50', totalPages: '200' }).bookProgress).toEqual({
      percent: 25,
      currentPage: 50,
      totalPages: 200,
      updatedAt: NOW,
    })
  })

  it('reaching the last page finishes the book', () => {
    const next = edit(base, { currentPage: '200', totalPages: '200' })
    expect(next.status).toBe(STATUS.finished)
    expect(next.finishedAt).toBe(NOW)
  })

  it('starting a finished book again keeps the earlier read', () => {
    const finished = { ...base, status: STATUS.finished, finishedAt: '2025-05-20T00:00:00.000Z' }
    const next = edit(finished, { status: STATUS.reading })
    expect(next.finishedAt).toBeUndefined()
    expect(next.previousReads).toEqual([{ startedAt: base.startedAt, finishedAt: '2025-05-20T00:00:00.000Z' }])
  })

  it('rejects a finish before the start', () => {
    const result = recordFromForm(base, { ...formFromRecord(base), finishedAt: '2025-04-01' }, now)
    expect(result).toEqual({ error: 'The finish date must be on or after the start date.' })
  })

  it('does not add owned:false to a record that never had it', () => {
    expect('owned' in edit(base, { stars: 6 })).toBe(false)
    expect(edit({ ...base, owned: true }, { owned: false }).owned).toBe(false)
  })
})

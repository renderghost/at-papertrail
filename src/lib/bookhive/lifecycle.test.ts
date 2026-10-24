import { describe, expect, it } from 'vitest'
import { nextReadingState, progressPercent, statusFromProgress, type ReadingState } from './lifecycle'
import { STATUS } from './types'

const NOW = '2025-06-01T12:00:00.000Z'
const now = () => NOW
const blank: ReadingState = { status: null, startedAt: null, finishedAt: null, previousReads: null }

describe('nextReadingState', () => {
  it('stamps the start date when a book enters Reading', () => {
    expect(nextReadingState(blank, { status: STATUS.reading }, { now })).toMatchObject({
      status: STATUS.reading,
      startedAt: NOW,
    })
  })

  it('does not re-stamp a book already being read', () => {
    const reading = { ...blank, status: STATUS.reading, startedAt: '2025-01-01T00:00:00.000Z' }
    expect(nextReadingState(reading, { status: STATUS.reading }, { now }).startedAt).toBe(reading.startedAt)
  })

  it('stamps the finish date when a book enters Finished', () => {
    const reading = { ...blank, status: STATUS.reading, startedAt: '2025-01-01T00:00:00.000Z' }
    expect(nextReadingState(reading, { status: STATUS.finished }, { now })).toMatchObject({
      status: STATUS.finished,
      startedAt: reading.startedAt,
      finishedAt: NOW,
    })
  })

  it('archives the finished read when a finished book is read again', () => {
    const finished: ReadingState = {
      status: STATUS.finished,
      startedAt: '2024-01-01T00:00:00.000Z',
      finishedAt: '2024-02-01T00:00:00.000Z',
      previousReads: [{ finishedAt: '2020-01-01T00:00:00.000Z' }],
    }
    expect(nextReadingState(finished, { status: STATUS.reading }, { now })).toEqual({
      status: STATUS.reading,
      startedAt: NOW,
      finishedAt: null,
      previousReads: [
        { startedAt: '2024-01-01T00:00:00.000Z', finishedAt: '2024-02-01T00:00:00.000Z' },
        { finishedAt: '2020-01-01T00:00:00.000Z' },
      ],
    })
  })

  it('treats a finish date on a want-to-read book as finishing it', () => {
    const want = { ...blank, status: STATUS.wantToRead }
    expect(nextReadingState(want, { finishedAt: '2025-05-20' }, { now })).toMatchObject({
      status: STATUS.finished,
      finishedAt: '2025-05-20T00:00:00.000Z',
    })
  })

  it('infers Reading from saved progress', () => {
    expect(nextReadingState(blank, { bookProgress: { percent: 40 } }, { now }).status).toBe(STATUS.reading)
  })
})

describe('statusFromProgress', () => {
  it('trusts exact page counts over a rounded percent', () => {
    expect(statusFromProgress(null, { percent: 100, currentPage: 657, totalPages: 658 })).toBe(STATUS.reading)
    expect(statusFromProgress(null, { currentPage: 658, totalPages: 658 })).toBe(STATUS.finished)
  })

  it('never changes a finished or abandoned book', () => {
    expect(statusFromProgress(STATUS.finished, { percent: 10 })).toBeUndefined()
    expect(statusFromProgress(STATUS.abandoned, { percent: 10 })).toBeUndefined()
  })
})

describe('progressPercent', () => {
  it('prefers pages, then chapters, then percent', () => {
    expect(progressPercent({ currentPage: 50, totalPages: 200, percent: 99, updatedAt: NOW })).toBe(25)
    expect(progressPercent({ currentChapter: 3, totalChapters: 12, updatedAt: NOW })).toBe(25)
    expect(progressPercent({ percent: 70, updatedAt: NOW })).toBe(70)
    expect(progressPercent(undefined)).toBeNull()
  })
})

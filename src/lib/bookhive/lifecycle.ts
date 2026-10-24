import { STATUS, type BookProgress, type PreviousRead } from './types'

/**
 * Status and date rules, mirroring BookHive's `core/bookLifecycle.ts` so a book
 * edited here behaves exactly as it would on bookhive.buzz.
 */

export type ReadingState = {
  status: string | null
  startedAt: string | null
  finishedAt: string | null
  previousReads: PreviousRead[] | null
}

/** What a write asserts. `undefined` means "says nothing about it", not "clear it". */
export type ReadingWrite = {
  status?: string
  /** `<input type="date">` value or an ISO datetime. */
  startedAt?: string
  finishedAt?: string
  /** Progress asserted by this write, not the stored progress. */
  bookProgress?: Omit<BookProgress, 'updatedAt'> | null
}

/** "2025-03-14" → "2025-03-14T00:00:00.000Z"; full ISO strings pass through. */
export function dateInputToIso(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00.000Z`
  return new Date(value).toISOString()
}

/** ISO datetime → `<input type="date">` value, using the UTC date BookHive stores. */
export function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

function asserted(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : dateInputToIso(value)
}

/** Saving progress implies Reading, or Finished at the very end. */
export function statusFromProgress(
  existingStatus: string | null | undefined,
  progress?: Omit<BookProgress, 'updatedAt'>,
): string | undefined {
  if (existingStatus === STATUS.finished || existingStatus === STATUS.abandoned) return undefined
  // Exact counts win over a percentage that may have rounded up.
  if (progress?.totalPages && progress.currentPage !== undefined) {
    return progress.currentPage === progress.totalPages ? STATUS.finished : STATUS.reading
  }
  if (progress?.totalChapters && progress.currentChapter !== undefined) {
    return progress.currentChapter === progress.totalChapters ? STATUS.finished : STATUS.reading
  }
  if (progress?.percent === 100) return STATUS.finished
  return STATUS.reading
}

export function nextReadingState(
  existing: ReadingState,
  write: ReadingWrite,
  { now = () => new Date().toISOString() }: { now?: () => string } = {},
): ReadingState {
  const startedInput = asserted(write.startedAt)
  const finishedInput = asserted(write.finishedAt)

  // Re-read: choosing Reading on a finished book archives the finished read.
  if (write.status === STATUS.reading && existing.status === STATUS.finished) {
    return {
      status: STATUS.reading,
      startedAt: startedInput ?? now(),
      finishedAt: null,
      previousReads: existing.finishedAt
        ? [
            { startedAt: existing.startedAt ?? undefined, finishedAt: existing.finishedAt },
            ...(existing.previousReads ?? []),
          ]
        : existing.previousReads,
    }
  }

  const currentStatus = write.status ?? existing.status
  let status = write.status ?? null

  if (write.bookProgress && !write.status) {
    status = statusFromProgress(existing.status, write.bookProgress) ?? status
  }
  if (
    startedInput &&
    status !== STATUS.finished &&
    (!currentStatus || currentStatus === STATUS.wantToRead)
  ) {
    status = STATUS.reading
  }
  if (
    finishedInput &&
    (!currentStatus || currentStatus === STATUS.wantToRead || currentStatus === STATUS.reading)
  ) {
    status = STATUS.finished
  }

  let startedAt = startedInput ?? existing.startedAt
  let finishedAt = finishedInput ?? existing.finishedAt

  // Stamp a date only when a book enters a status.
  const alreadyReading = existing.status === STATUS.reading && !!existing.startedAt
  const alreadyFinished = existing.status === STATUS.finished && !!existing.finishedAt
  if (status === STATUS.reading && !startedInput && !alreadyReading) {
    startedAt = now()
  } else if (status === STATUS.finished && !finishedInput && !alreadyFinished) {
    finishedAt = now()
  }

  return {
    status: status ?? existing.status,
    startedAt,
    finishedAt,
    previousReads: existing.previousReads,
  }
}

export function readingDatesProblem(state: {
  startedAt: string | null
  finishedAt: string | null
}): string | null {
  if (!state.startedAt || !state.finishedAt) return null
  return state.finishedAt.slice(0, 10) < state.startedAt.slice(0, 10)
    ? 'The finish date must be on or after the start date.'
    : null
}

export function progressProblem(progress: Omit<BookProgress, 'updatedAt'>): string | null {
  const { percent, currentPage, totalPages } = progress
  if (percent !== undefined && (percent < 0 || percent > 100)) return 'Progress must be 0–100%.'
  if (currentPage !== undefined && currentPage < 1) return 'The current page must be at least 1.'
  if (totalPages !== undefined && totalPages < 1) return 'The page count must be at least 1.'
  if (currentPage !== undefined && totalPages !== undefined && currentPage > totalPages) {
    return 'The current page is past the last page.'
  }
  return null
}

/** Percent through the book, from exact counts when available. */
export function progressPercent(progress: BookProgress | undefined): number | null {
  if (!progress) return null
  if (progress.totalPages && progress.currentPage !== undefined) {
    return Math.min(100, Math.round((progress.currentPage / progress.totalPages) * 100))
  }
  if (progress.totalChapters && progress.currentChapter !== undefined) {
    return Math.min(100, Math.round((progress.currentChapter / progress.totalChapters) * 100))
  }
  return progress.percent ?? null
}

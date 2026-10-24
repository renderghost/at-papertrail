import {
  isoToDateInput,
  nextReadingState,
  progressProblem,
  readingDatesProblem,
  type ReadingWrite,
} from './lifecycle'
import { applyPatch, type BookPatch } from './library'
import { STATUS, type BookProgress, type BookRecord } from './types'

/** What the book editor holds. Dates are `<input type="date">` values. */
export type EditForm = {
  status: string
  startedAt: string
  finishedAt: string
  /** 0 = no rating, otherwise 1–10. */
  stars: number
  review: string
  /** Blank strings mean "not set". */
  percent: string
  currentPage: string
  totalPages: string
  owned: boolean
}

export function formFromRecord(record: BookRecord): EditForm {
  const p = record.bookProgress
  return {
    status: record.status ?? '',
    startedAt: isoToDateInput(record.startedAt),
    finishedAt: isoToDateInput(record.finishedAt),
    stars: record.stars ?? 0,
    review: record.review ?? '',
    percent: p?.percent !== undefined ? String(p.percent) : '',
    currentPage: p?.currentPage !== undefined ? String(p.currentPage) : '',
    totalPages: p?.totalPages !== undefined ? String(p.totalPages) : '',
    owned: record.owned ?? false,
  }
}

function toInt(value: string): number | undefined {
  if (value.trim() === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n) : undefined
}

function formProgress(form: EditForm): Omit<BookProgress, 'updatedAt'> | null {
  const currentPage = toInt(form.currentPage)
  const totalPages = toInt(form.totalPages)
  let percent = toInt(form.percent)
  if (currentPage !== undefined && totalPages) {
    percent = Math.min(100, Math.round((currentPage / totalPages) * 100))
  }
  if (percent === undefined && currentPage === undefined && totalPages === undefined) return null
  return {
    ...(percent !== undefined ? { percent } : {}),
    ...(currentPage !== undefined ? { currentPage } : {}),
    ...(totalPages !== undefined ? { totalPages } : {}),
  }
}

function sameProgress(a: Omit<BookProgress, 'updatedAt'> | null, b: BookProgress | undefined): boolean {
  if (!a || !b) return !a && !b
  return a.percent === b.percent && a.currentPage === b.currentPage && a.totalPages === b.totalPages
}

/** Previews the status change the form implies, for the editor to warn about re-reads. */
export function isReRead(record: BookRecord, form: EditForm): boolean {
  return record.status === STATUS.finished && form.status === STATUS.reading
}

/**
 * Turns an edited form into the next record, applying BookHive's lifecycle
 * rules. Returns an error message instead when the input doesn't make sense.
 */
export function recordFromForm(
  record: BookRecord,
  form: EditForm,
  now: () => string = () => new Date().toISOString(),
): { record: BookRecord } | { error: string } {
  const previous = formFromRecord(record)
  const write: ReadingWrite = {}
  if (form.status && form.status !== previous.status) write.status = form.status
  if (form.startedAt && form.startedAt !== previous.startedAt) write.startedAt = form.startedAt
  if (form.finishedAt && form.finishedAt !== previous.finishedAt) write.finishedAt = form.finishedAt

  const progress = formProgress(form)
  const progressChanged = !sameProgress(progress, record.bookProgress)
  if (progress) {
    const problem = progressProblem(progress)
    if (problem) return { error: problem }
  }
  if (progressChanged && progress) write.bookProgress = progress

  const state = nextReadingState(
    {
      status: record.status ?? null,
      startedAt: record.startedAt ?? null,
      finishedAt: record.finishedAt ?? null,
      previousReads: record.previousReads ?? null,
    },
    write,
    { now },
  )

  // Emptying a date field clears it, unless a re-read just reset the dates.
  const reRead = isReRead(record, form)
  if (!reRead && !form.startedAt && previous.startedAt) state.startedAt = null
  if (!reRead && !form.finishedAt && previous.finishedAt) state.finishedAt = null

  const datesProblem = readingDatesProblem(state)
  if (datesProblem) return { error: datesProblem }

  const review = form.review.trim()
  const patch: BookPatch = {
    status: state.status,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    previousReads: state.previousReads?.length ? state.previousReads : null,
    stars: form.stars >= 1 && form.stars <= 10 ? Math.round(form.stars) : null,
    review: review ? review : null,
    // Don't add `owned: false` to a record that never said anything about it.
    owned: form.owned || record.owned !== undefined ? form.owned : undefined,
  }
  if (progressChanged) {
    patch.bookProgress = progress ? { ...progress, updatedAt: now() } : null
  }
  return { record: applyPatch(record, patch) }
}

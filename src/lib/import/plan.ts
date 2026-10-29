import { formatAuthors } from '../bookhive/authors'
import { catalogUri } from '../bookhive/catalog'
import { getHiveId } from '../bookhive/hiveId'
import { BOOK_COLLECTION, type BookEntry, type BookIdentifiers, type BookRecord, type CatalogBook, type PreviousRead } from '../bookhive/types'
import { clipBytes } from '../lists'
import type { RowMatch } from './match'
import type { ImportRow } from './sources'

/**
 * What an import will do, decided before anything is written, so the preview
 * shows every change (#57). The rule is **fill gaps, never overwrite**: a book
 * already in your library only gains what it's missing.
 */

export type Change = 'status' | 'started' | 'finished' | 'rating' | 'review' | 'owned' | 'reads' | 'identifiers'

export const CHANGE_LABEL: Record<Change, string> = {
  status: 'status',
  started: 'start date',
  finished: 'finish date',
  rating: 'rating',
  review: 'review',
  owned: 'owned',
  reads: 'earlier reads',
  identifiers: 'ISBN or Goodreads id',
}

export type PlanItem =
  /** A new record. `catalogued` is false for a book BookHive doesn't know yet (flagged for the match fixer). */
  | { kind: 'create'; rows: ImportRow[]; record: BookRecord; catalogued: boolean }
  | { kind: 'update'; rows: ImportRow[]; entry: BookEntry; next: BookRecord; changes: Change[] }
  | { kind: 'same'; rows: ImportRow[]; entry: BookEntry }
  | { kind: 'unmatched'; row: ImportRow; suggestions: CatalogBook[] }

/** BookHive allows 50 earlier reads. */
const MAX_PREVIOUS_READS = 50

const day = (iso: string | undefined) => iso?.slice(0, 10)

/** Adds the row's reads that the record doesn't have, most recent first. */
function mergeReads(record: BookRecord, reads: PreviousRead[]): PreviousRead[] | undefined {
  const known = new Set([day(record.finishedAt), ...(record.previousReads ?? []).map((r) => day(r.finishedAt))])
  const added = reads.filter((r) => !known.has(day(r.finishedAt)))
  if (!added.length) return undefined
  return [...(record.previousReads ?? []), ...added]
    .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))
    .slice(0, MAX_PREVIOUS_READS)
}

function rowIdentifiers(row: ImportRow): BookIdentifiers {
  return {
    ...(row.isbn13 ? { isbn13: row.isbn13 } : {}),
    ...(row.isbn10 ? { isbn10: row.isbn10 } : {}),
    ...(row.goodreadsId ? { goodreadsId: row.goodreadsId } : {}),
  }
}

/** The record with whatever the row adds; existing values always win. */
export function fillGaps(record: BookRecord, row: ImportRow): { next: BookRecord; changes: Change[] } {
  const next: BookRecord = { ...record, $type: BOOK_COLLECTION }
  const changes: Change[] = []

  if (!next.status) {
    next.status = row.status
    changes.push('status')
  }
  // Dates only belong to the read the row describes when the statuses agree.
  const sameRead = next.status === row.status
  if (sameRead && !next.startedAt && row.startedAt) {
    next.startedAt = row.startedAt
    changes.push('started')
  }
  if (sameRead && !next.finishedAt && row.finishedAt) {
    next.finishedAt = row.finishedAt
    changes.push('finished')
  }
  // A finished read the record holds elsewhere (or a different one) joins the history.
  const rowReads = [...(row.finishedAt && next.finishedAt !== row.finishedAt ? [{ ...(row.startedAt ? { startedAt: row.startedAt } : {}), finishedAt: row.finishedAt }] : []), ...row.previousReads]
  const reads = mergeReads(next, rowReads)
  if (reads) {
    next.previousReads = reads
    changes.push('reads')
  }
  if (next.stars === undefined && row.stars !== undefined) {
    next.stars = row.stars
    changes.push('rating')
  }
  if (!next.review?.trim() && row.review) {
    next.review = row.review
    changes.push('review')
  }
  if (row.owned && !next.owned) {
    next.owned = true
    changes.push('owned')
  }
  const ids = rowIdentifiers(row)
  const missing = (Object.keys(ids) as (keyof BookIdentifiers)[]).filter((k) => !next.identifiers?.[k])
  if (missing.length) {
    next.identifiers = { ...next.identifiers, ...Object.fromEntries(missing.map((k) => [k, ids[k]])) }
    changes.push('identifiers')
  }
  return { next, changes }
}

/** A new record for a row, from the catalogue entry when BookHive knows the book. */
export function importRecord(row: ImportRow, catalogue: CatalogBook | null, now: () => string = () => new Date().toISOString()): BookRecord {
  const hiveId = catalogue?.id ?? getHiveId({ title: row.bareTitle, authors: row.authors[0] ?? '' })
  const base: BookRecord = {
    $type: BOOK_COLLECTION,
    // BookHive's lexicon caps these (in UTF-8 bytes); its indexer may skip a record that breaks them.
    title: clipBytes(catalogue?.title ?? row.bareTitle, 512),
    authors: clipBytes(catalogue?.authors ?? formatAuthors(row.authors), 2048),
    hiveId,
    createdAt: row.createdAt ?? now(),
    // Your edition's ISBNs win over the catalogue's, as in BookHive's own import, so a re-run finds the book.
    identifiers: { ...catalogue?.identifiers, ...rowIdentifiers(row), hiveId },
    ...(catalogue ? { hiveBookUri: catalogUri(hiveId) } : {}),
  }
  return fillGaps(base, row).next
}

export type Resolution = { book: CatalogBook | null } | 'skip'

/**
 * Turns matched rows into a plan. Rows for the same book (a duplicate in the
 * file, or a book already in your library) merge into one write.
 * `resolutions` holds the preview's choices for unmatched rows, by line:
 * a catalogue book, `{ book: null }` to save it uncatalogued, or 'skip'.
 */
export function buildPlan(
  rows: ImportRow[],
  matches: Map<number, RowMatch>,
  resolutions: Map<number, Resolution> = new Map(),
  now: () => string = () => new Date().toISOString(),
): PlanItem[] {
  const plan: PlanItem[] = []
  const byHiveId = new Map<string, PlanItem & { kind: 'create' | 'update' | 'same' }>()

  const add = (row: ImportRow, start: () => PlanItem & { kind: 'create' | 'update' | 'same' }, hiveId: string) => {
    const existing = byHiveId.get(hiveId)
    if (!existing) {
      const item = start()
      byHiveId.set(hiveId, item)
      plan.push(item)
      return
    }
    // A later row for the same book fills what's still missing.
    existing.rows.push(row)
    if (existing.kind === 'create') {
      existing.record = fillGaps(existing.record, row).next
      return
    }
    const base = existing.kind === 'update' ? existing.next : existing.entry.value
    const { next, changes } = fillGaps(base, row)
    if (!changes.length) return
    const merged: PlanItem & { kind: 'update' } = {
      kind: 'update',
      rows: existing.rows,
      entry: existing.entry,
      next,
      changes: [...new Set([...(existing.kind === 'update' ? existing.changes : []), ...changes])],
    }
    plan[plan.indexOf(existing)] = merged
    byHiveId.set(hiveId, merged)
  }

  for (const row of rows) {
    const match = matches.get(row.line)
    if (!match) continue
    if (match.kind === 'library') {
      const entry = match.entry
      add(
        row,
        () => {
          const { next, changes } = fillGaps(entry.value, row)
          return changes.length ? { kind: 'update', rows: [row], entry, next, changes } : { kind: 'same', rows: [row], entry }
        },
        entry.value.hiveId,
      )
      continue
    }
    let catalogue: CatalogBook | null
    if (match.kind === 'catalogue') catalogue = match.book
    else {
      const resolution = resolutions.get(row.line)
      if (!resolution) {
        plan.push({ kind: 'unmatched', row, suggestions: match.suggestions })
        continue
      }
      if (resolution === 'skip') continue
      catalogue = resolution.book
    }
    const record = importRecord(row, catalogue, now)
    add(row, () => ({ kind: 'create', rows: [row], record, catalogued: !!catalogue }), record.hiveId)
  }
  return plan
}

export type PlanSummary = {
  create: number
  uncatalogued: number
  update: number
  same: number
  unmatched: number
  rounded: number
  undatedRereads: number
  moods: number
  pace: number
  contentWarnings: number
  spoilers: number
}

export function summarise(plan: PlanItem[], rows: ImportRow[]): PlanSummary {
  const count = (kind: PlanItem['kind']) => plan.filter((p) => p.kind === kind).length
  return {
    create: count('create'),
    uncatalogued: plan.filter((p) => p.kind === 'create' && !p.catalogued).length,
    update: count('update'),
    same: count('same'),
    unmatched: count('unmatched'),
    rounded: rows.filter((r) => r.ratingRounded).length,
    undatedRereads: rows.reduce((n, r) => n + r.extras.undatedRereads, 0),
    moods: rows.filter((r) => r.extras.moods).length,
    pace: rows.filter((r) => r.extras.pace).length,
    contentWarnings: rows.filter((r) => r.extras.contentWarnings).length,
    spoilers: rows.filter((r) => r.extras.spoiler).length,
  }
}

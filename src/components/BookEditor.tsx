import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formFromRecord, isReRead, recordFromForm, type EditForm } from '../lib/bookhive/edit'
import { StaleRecordError } from '../lib/bookhive/library'
import { STATUS, STATUS_LABEL, type BookEntry, type BookStatus } from '../lib/bookhive/types'
import { useBookWrites } from '../lib/hooks'
import { StarInput } from './bits'

const STATUSES: BookStatus[] = [STATUS.wantToRead, STATUS.reading, STATUS.finished, STATUS.abandoned]
const REVIEW_LIMIT = 15000

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function graphemes(text: string): number {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return [...new Intl.Segmenter('en-GB', { granularity: 'grapheme' }).segment(text)].length
  }
  return [...text].length
}

export function BookEditor({ entry, totalPagesHint }: { entry: BookEntry; totalPagesHint?: number }) {
  const navigate = useNavigate()
  const { update, remove } = useBookWrites()
  const initial = useMemo(() => formFromRecord(entry.value), [entry.value])
  const [form, setForm] = useState<EditForm>(initial)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pagesMode, setPagesMode] = useState(initial.totalPages !== '' || (!initial.percent && !!totalPagesHint))

  // A newer copy of the record (e.g. after saving) resets the form.
  useEffect(() => setForm(initial), [initial])

  const set = <K extends keyof EditForm>(key: K, value: EditForm[K]) => {
    setSaved(false)
    setError(null)
    setForm((f) => ({ ...f, [key]: value }))
  }

  const chooseStatus = (status: BookStatus) => {
    setSaved(false)
    setError(null)
    setForm((f) => {
      const next = { ...f, status }
      if (entry.value.status === STATUS.finished && status === STATUS.reading) {
        // A re-read starts today; the finished read moves to history on save.
        return { ...next, startedAt: today(), finishedAt: '' }
      }
      if (status === STATUS.reading && !f.startedAt) next.startedAt = today()
      if (status === STATUS.finished && !f.finishedAt) next.finishedAt = today()
      return next
    })
  }

  const result = recordFromForm(entry.value, form)
  const dirty = 'record' in result ? JSON.stringify(result.record) !== JSON.stringify(entry.value) : true
  const reRead = isReRead(entry.value, form)
  const reviewLength = graphemes(form.review)

  const save = async () => {
    if ('error' in result) {
      setError(result.error)
      return
    }
    if (reviewLength > REVIEW_LIMIT) {
      setError(`Reviews can be up to ${REVIEW_LIMIT.toLocaleString('en-GB')} characters.`)
      return
    }
    try {
      await update.mutateAsync({ entry, next: result.record })
      setSaved(true)
    } catch (err) {
      setError(err instanceof StaleRecordError ? err.message : `Couldn't save: ${(err as Error).message}`)
    }
  }

  const destroy = async () => {
    try {
      await remove.mutateAsync(entry)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof StaleRecordError ? err.message : `Couldn't remove: ${(err as Error).message}`)
      setConfirmDelete(false)
    }
  }

  return (
    <form
      className="panel editor"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <div className="field">
        <span className="label" id="status-label">
          Status
        </span>
        <div className="segmented" role="group" aria-labelledby="status-label">
          {STATUSES.map((s) => (
            <button type="button" key={s} aria-pressed={form.status === s} onClick={() => chooseStatus(s)}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        {reRead && (
          <p className="small muted">Starting a re-read. Your finished read is kept in this book's history.</p>
        )}
      </div>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="startedAt">Started</label>
          <input
            id="startedAt"
            className="input"
            type="date"
            max={today()}
            value={form.startedAt}
            onChange={(e) => set('startedAt', e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="finishedAt">Finished</label>
          <input
            id="finishedAt"
            className="input"
            type="date"
            max={today()}
            min={form.startedAt || undefined}
            value={form.finishedAt}
            onChange={(e) => set('finishedAt', e.target.value)}
          />
        </div>
      </div>

      {(form.status === STATUS.reading || form.percent || form.currentPage) && (
        <div className="field">
          <span className="label">Progress</span>
          {pagesMode ? (
            <div className="row">
              <span>Page</span>
              <input
                className="input"
                style={{ width: 96 }}
                inputMode="numeric"
                aria-label="Current page"
                value={form.currentPage}
                onChange={(e) => {
                  const page = e.target.value.replace(/\D/g, '')
                  setSaved(false)
                  setError(null)
                  setForm((f) => ({
                    ...f,
                    currentPage: page,
                    totalPages: f.totalPages || (totalPagesHint ? String(totalPagesHint) : ''),
                  }))
                }}
              />
              <span>of</span>
              <input
                className="input"
                style={{ width: 96 }}
                inputMode="numeric"
                aria-label="Total pages"
                placeholder={totalPagesHint ? String(totalPagesHint) : '—'}
                value={form.totalPages}
                onChange={(e) => set('totalPages', e.target.value.replace(/\D/g, ''))}
              />
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                onClick={() => {
                  setPagesMode(false)
                  setForm((f) => ({ ...f, currentPage: '', totalPages: '' }))
                }}
              >
                Use %
              </button>
            </div>
          ) : (
            <div className="row">
              <input
                type="range"
                min={0}
                max={100}
                value={form.percent || '0'}
                onChange={(e) => set('percent', e.target.value)}
                aria-label="Percent read"
                style={{ flex: 1, accentColor: 'var(--accent)', minWidth: 120 }}
              />
              <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 44 }}>{form.percent || 0}%</span>
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                onClick={() => {
                  setPagesMode(true)
                  setForm((f) => ({ ...f, percent: '' }))
                }}
              >
                Use pages
              </button>
            </div>
          )}
        </div>
      )}

      <div className="field">
        <span className="label">Rating</span>
        <StarInput value={form.stars} onChange={(s) => set('stars', s)} />
      </div>

      <div className="field">
        <label htmlFor="review">Review</label>
        <textarea
          id="review"
          className="textarea"
          placeholder="What stayed with you?"
          value={form.review}
          onChange={(e) => set('review', e.target.value)}
        />
        {reviewLength > REVIEW_LIMIT * 0.9 && (
          <span className="small muted">
            {reviewLength.toLocaleString('en-GB')} / {REVIEW_LIMIT.toLocaleString('en-GB')}
          </span>
        )}
      </div>

      <label className="checkbox">
        <input type="checkbox" checked={form.owned} onChange={(e) => set('owned', e.target.checked)} />I own a copy
      </label>

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      {saved && !dirty && (
        <div className="notice notice-ok" role="status">
          Saved to your PDS.
        </div>
      )}

      <div className="editor-actions">
        <div className="row">
          <button className="btn btn-primary" type="submit" disabled={!dirty || update.isPending}>
            {update.isPending ? 'Saving…' : 'Save'}
          </button>
          {dirty && (
            <button type="button" className="btn btn-quiet" onClick={() => setForm(initial)}>
              Discard changes
            </button>
          )}
        </div>
        {confirmDelete ? (
          <div className="row">
            <span className="small">Remove from your library?</span>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => void destroy()} disabled={remove.isPending}>
              {remove.isPending ? 'Removing…' : 'Remove'}
            </button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setConfirmDelete(false)}>
              Keep
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setConfirmDelete(true)}>
            Remove from library
          </button>
        )}
      </div>
    </form>
  )
}

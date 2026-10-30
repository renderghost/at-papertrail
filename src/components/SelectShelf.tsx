import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../lib/auth'
import { describeBatch, planBatch, type BatchChange } from '../lib/batch'
import { displayAuthors } from '../lib/bookhive/authors'
import { STATUS, STATUS_LABEL, type BookEntry, type BookStatus } from '../lib/bookhive/types'
import { describeError } from '../lib/errors'
import { plural } from '../lib/format'
import { bookPath } from '../lib/paths'
import { useLists } from '../lib/useLists'
import { applyWrites, type Write } from '../lib/xrpc'
import { Stars, StatusPill } from './bits'

const STATUSES: BookStatus[] = [STATUS.wantToRead, STATUS.reading, STATUS.finished, STATUS.abandoned]

/**
 * Select mode on your shelves (#100): the shown books as a table, for changing
 * many at once. Each change is one write to your PDS, and can be undone.
 */
export function SelectShelf({ entries, onDone }: { entries: BookEntry[]; onDone: () => void }) {
  const { did, session } = useSession()
  const queryClient = useQueryClient()
  const lists = useLists(did)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [notice, setNotice] = useState<{ text: string; undo: Write[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const chosen = entries.filter((e) => selected.has(e.uri))
  const all = entries.length > 0 && chosen.length === entries.length

  const write = useMutation({
    mutationFn: (writes: Write[]) => applyWrites(session, writes),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['library', did] })
      void queryClient.invalidateQueries({ queryKey: ['lists', did] })
    },
  })

  const apply = async (change: BatchChange) => {
    setError(null)
    setConfirmRemove(false)
    const plan = planBatch(chosen, change)
    if (!plan.writes.length) {
      setNotice({ text: 'Nothing to change: they already are.', undo: [] })
      return
    }
    try {
      await write.mutateAsync(plan.writes)
      setNotice({ text: describeBatch(change, plan.changed, (s) => STATUS_LABEL[s]), undo: plan.undo })
      if (change.kind === 'remove') setSelected(new Set())
    } catch (err) {
      setError(describeError(err).message)
    }
  }

  const undo = async () => {
    if (!notice?.undo.length) return
    try {
      await write.mutateAsync(notice.undo)
      setNotice({ text: 'Undone.', undo: [] })
    } catch (err) {
      setError(describeError(err).message)
    }
  }

  const toggle = (uri: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(uri)) next.delete(uri)
      else next.add(uri)
      return next
    })

  const busy = write.isPending || !chosen.length
  return (
    <div className="select-shelf">
      <div className="batch-bar" role="group" aria-label="Change the selected books">
        <strong className="batch-count">{chosen.length ? `${plural(chosen.length, 'book')} selected` : 'Select books to change'}</strong>
        <select
          className="select"
          aria-label="Set status"
          value=""
          disabled={busy}
          onChange={(e) => e.target.value && void apply({ kind: 'status', status: e.target.value as BookStatus })}
        >
          <option value="">Set status…</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void apply({ kind: 'owned', owned: true })}>
          Mark owned
        </button>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void apply({ kind: 'owned', owned: false })}>
          Not owned
        </button>
        {(lists.data?.length ?? 0) > 0 && (
          <select
            className="select"
            aria-label="Add to list"
            value=""
            disabled={busy}
            onChange={(e) => {
              const list = lists.data?.find((l) => l.uri === e.target.value)
              if (list) void apply({ kind: 'list', list })
            }}
          >
            <option value="">Add to list…</option>
            {lists.data!.map((l) => (
              <option key={l.uri} value={l.uri}>
                {l.value.name}
              </option>
            ))}
          </select>
        )}
        {confirmRemove ? (
          <>
            <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => void apply({ kind: 'remove' })}>
              Remove {plural(chosen.length, 'book')}
            </button>
            <button type="button" className="btn btn-sm btn-quiet" onClick={() => setConfirmRemove(false)}>
              Keep them
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-sm btn-quiet" disabled={busy} onClick={() => setConfirmRemove(true)}>
            Remove…
          </button>
        )}
        <button type="button" className="btn btn-sm btn-primary batch-done" onClick={onDone}>
          Done
        </button>
      </div>
      {notice && (
        <p className="notice notice-ok" role="status">
          {notice.text}
          {notice.undo.length > 0 && (
            <>
              {' '}
              <button type="button" className="btn btn-sm btn-quiet" disabled={write.isPending} onClick={() => void undo()}>
                Undo
              </button>
            </>
          )}
        </p>
      )}
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <div className="table-wrap">
        <table className="book-table">
          <caption className="visually-hidden">Your books: tick the ones to change</caption>
          <thead>
            <tr>
              <th scope="col" className="pick">
                <input
                  type="checkbox"
                  aria-label="Select every book shown"
                  checked={all}
                  ref={(el) => {
                    if (el) el.indeterminate = chosen.length > 0 && !all
                  }}
                  onChange={() => setSelected(all ? new Set() : new Set(entries.map((e) => e.uri)))}
                />
              </th>
              <th scope="col">Title</th>
              <th scope="col">Author</th>
              <th scope="col">Status</th>
              <th scope="col">Rating</th>
              <th scope="col">Owned</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const v = e.value
              const on = selected.has(e.uri)
              return (
                <tr key={e.uri} className={on ? 'selected' : undefined}>
                  <td className="pick">
                    <input type="checkbox" aria-label={`Select ${v.title}`} checked={on} onChange={() => toggle(e.uri)} />
                  </td>
                  <th scope="row">
                    <Link to={bookPath(v.hiveId)} state={{ entry: e }}>
                      {v.title}
                    </Link>
                  </th>
                  <td>{displayAuthors(v.authors)}</td>
                  <td>
                    <StatusPill status={v.status} />
                  </td>
                  <td>
                    <Stars stars={v.stars} size={12} />
                  </td>
                  <td>{v.owned ? 'Owned' : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

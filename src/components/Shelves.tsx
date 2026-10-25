import { useMemo, useState } from 'react'
import { STATUS, type BookEntry, type BookStatus } from '../lib/bookhive/types'
import { Empty } from './bits'
import { BookTile } from './BookTile'

type Filter = BookStatus | 'all'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: STATUS.reading, label: 'Reading' },
  { key: STATUS.wantToRead, label: 'Want to read' },
  { key: STATUS.finished, label: 'Finished' },
  { key: STATUS.abandoned, label: 'Abandoned' },
]

type Sort = 'recent' | 'title' | 'rating'

/** Most recent activity on the record, for "recent" ordering. */
function activity(e: BookEntry): number {
  const v = e.value
  return Math.max(
    ...[v.finishedAt, v.startedAt, v.bookProgress?.updatedAt, v.createdAt].map((d) => (d ? Date.parse(d) || 0 : 0)),
  )
}

export function Shelves({ entries, emptyMessage }: { entries: BookEntry[]; emptyMessage: string }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('recent')

  const counts = useMemo(() => {
    const c = new Map<Filter, number>([['all', entries.length]])
    for (const e of entries) {
      const s = e.value.status as Filter
      c.set(s, (c.get(s) ?? 0) + 1)
    }
    return c
  }, [entries])

  const shown = useMemo(() => {
    const list = filter === 'all' ? entries : entries.filter((e) => e.value.status === filter)
    return [...list].sort((a, b) => {
      if (sort === 'title') return a.value.title.localeCompare(b.value.title)
      if (sort === 'rating') return (b.value.stars ?? 0) - (a.value.stars ?? 0) || activity(b) - activity(a)
      return activity(b) - activity(a)
    })
  }, [entries, filter, sort])

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 20 }}>
        <div className="chips" role="group" aria-label="Filter by status">
          {FILTERS.filter((f) => f.key === 'all' || counts.get(f.key)).map((f) => (
            <button key={f.key} className="chip" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label}
              <span className="n">{counts.get(f.key) ?? 0}</span>
            </button>
          ))}
        </div>
        <label className="row small muted">
          <span>Sort</span>
          <select className="select" style={{ minHeight: 34, padding: '4px 8px', width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="recent">Recent activity</option>
            <option value="title">Title</option>
            <option value="rating">Rating</option>
          </select>
        </label>
      </div>
      {shown.length === 0 ? (
        <Empty title="Nothing here yet">
          <p>{emptyMessage}</p>
        </Empty>
      ) : (
        <div className="shelf">
          {shown.map((e) => (
            <BookTile key={e.uri} entry={e} />
          ))}
        </div>
      )}
    </div>
  )
}

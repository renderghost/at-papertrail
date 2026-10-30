import { useMemo, useState } from 'react'
import { STATUS, STATUS_LABEL, type BookEntry, type BookStatus } from '../lib/bookhive/types'
import { Empty } from './bits'
import { BookTile, type ShelfView } from './BookTile'
import { SelectShelf } from './SelectShelf'

type Filter = BookStatus | 'all'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  ...[STATUS.reading, STATUS.wantToRead, STATUS.finished, STATUS.abandoned].map((key) => ({ key, label: STATUS_LABEL[key] })),
]

type Sort = 'recent' | 'title' | 'rating'

/** Ownership (#62): every book, the ones you own, or owned but not read (your "read what you own" list). */
type Owned = 'any' | 'owned' | 'unread'

const isOwned = (e: BookEntry) => e.value.owned === true
const ownedUnread = (e: BookEntry) =>
  isOwned(e) && e.value.status !== STATUS.finished && e.value.status !== STATUS.abandoned && !e.value.previousReads?.length

/** Most recent activity on the record, for "recent" ordering. */
function activity(e: BookEntry): number {
  const v = e.value
  return Math.max(
    ...[v.finishedAt, v.startedAt, v.bookProgress?.updatedAt, v.createdAt].map((d) => (d ? Date.parse(d) || 0 : 0)),
  )
}

const VIEW_KEY = 'papertrail-shelf-view'

function storedView(): ShelfView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'covers' ? 'covers' : 'details'
  } catch {
    return 'details'
  }
}

/** `editable` (your own Library) adds Select mode: a table for changing many books at once (#100). */
export function Shelves({ entries, emptyMessage, editable = false }: { entries: BookEntry[]; emptyMessage: string; editable?: boolean }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [selecting, setSelecting] = useState(false)
  // Covers only, or with title, author and stars: the reader's choice, remembered in this browser (#100).
  const [view, setView] = useState<ShelfView>(storedView)
  const chooseView = (next: ShelfView) => {
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // Private mode: it just won't be remembered.
    }
  }
  const [sort, setSort] = useState<Sort>('recent')
  const [owned, setOwned] = useState<Owned>('any')
  const ownedCounts = useMemo(() => ({ owned: entries.filter(isOwned).length, unread: entries.filter(ownedUnread).length }), [entries])
  const pool = useMemo(() => (owned === 'owned' ? entries.filter(isOwned) : owned === 'unread' ? entries.filter(ownedUnread) : entries), [entries, owned])

  const counts = useMemo(() => {
    const c = new Map<Filter, number>([['all', pool.length]])
    for (const e of pool) {
      const s = e.value.status as Filter
      c.set(s, (c.get(s) ?? 0) + 1)
    }
    return c
  }, [pool])

  const shown = useMemo(() => {
    const list = filter === 'all' ? pool : pool.filter((e) => e.value.status === filter)
    return [...list].sort((a, b) => {
      if (sort === 'title') return a.value.title.localeCompare(b.value.title)
      if (sort === 'rating') return (b.value.stars ?? 0) - (a.value.stars ?? 0) || activity(b) - activity(a)
      return activity(b) - activity(a)
    })
  }, [pool, filter, sort])

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 20 }}>
        <div className="stack shelf-filters">
          <div className="chips" role="group" aria-label="Filter by status">
            {FILTERS.filter((f) => f.key === 'all' || counts.get(f.key) || filter === f.key).map((f) => (
              <button key={f.key} className="chip" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.label}
                <span className="n">{counts.get(f.key) ?? 0}</span>
              </button>
            ))}
          </div>
          {ownedCounts.owned > 0 && (
            <div className="chips" role="group" aria-label="Filter by ownership">
              <button className="chip" aria-pressed={owned === 'any'} onClick={() => setOwned('any')}>
                Every book
              </button>
              <button className="chip" aria-pressed={owned === 'owned'} onClick={() => setOwned('owned')}>
                Owned
                <span className="n">{ownedCounts.owned}</span>
              </button>
              <button className="chip" aria-pressed={owned === 'unread'} onClick={() => setOwned('unread')}>
                Owned, not read yet
                <span className="n">{ownedCounts.unread}</span>
              </button>
            </div>
          )}
        </div>
        <div className="row shelf-view">
          {editable && !selecting && (
            <button type="button" className="btn btn-sm" onClick={() => setSelecting(true)}>
              Select
            </button>
          )}
          <div className="chips" role="group" aria-label="Show" hidden={selecting}>
            <button className="chip" aria-pressed={view === 'covers'} onClick={() => chooseView('covers')}>
              Covers
            </button>
            <button className="chip" aria-pressed={view === 'details'} onClick={() => chooseView('details')}>
              Details
            </button>
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
      </div>
      {selecting ? (
        <SelectShelf entries={shown} onDone={() => setSelecting(false)} />
      ) : shown.length === 0 ? (
        <Empty title="Nothing here yet">
          <p>{emptyMessage}</p>
        </Empty>
      ) : (
        <div className={`shelf shelf-${view}`}>
          {shown.map((e) => (
            <BookTile key={e.uri} entry={e} view={view} />
          ))}
        </div>
      )}
    </div>
  )
}

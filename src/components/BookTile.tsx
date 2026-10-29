import { Link } from 'react-router-dom'
import { displayAuthors } from '../lib/bookhive/authors'
import { STATUS, type BookEntry } from '../lib/bookhive/types'
import { bookPath } from '../lib/paths'
import { Progress, Stars } from './bits'
import { Cover } from './Cover'

export function BookTile({ entry }: { entry: BookEntry }) {
  const v = entry.value
  return (
    <Link className="tile" to={bookPath(v.hiveId)} state={{ entry }}>
      <Cover hiveId={v.hiveId} title={v.title} authors={v.authors} entry={entry} />
      <div>
        <div className="tile-title">{v.title}</div>
        <div className="tile-author">{displayAuthors(v.authors)}</div>
        {v.status === STATUS.reading && <Progress progress={v.bookProgress} compact />}
        {v.stars ? <Stars stars={v.stars} size={13} /> : null}
      </div>
    </Link>
  )
}

export function ReadingCard({ entry }: { entry: BookEntry }) {
  const v = entry.value
  return (
    <Link className="reading-card" to={bookPath(v.hiveId)} state={{ entry }}>
      <Cover hiveId={v.hiveId} title={v.title} authors={v.authors} entry={entry} size="sm" />
      <div className="body">
        <h3>{v.title}</h3>
        <div className="muted small">{displayAuthors(v.authors)}</div>
        <div style={{ marginTop: 'auto' }}>
          {v.bookProgress ? (
            <Progress progress={v.bookProgress} />
          ) : (
            <span className="muted small">No progress logged yet</span>
          )}
        </div>
      </div>
    </Link>
  )
}

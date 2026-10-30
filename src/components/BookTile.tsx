import { Link } from 'react-router-dom'
import { displayAuthors } from '../lib/bookhive/authors'
import { STATUS, type BookEntry } from '../lib/bookhive/types'
import { bookPath } from '../lib/paths'
import { Progress, Stars } from './bits'
import { BookCard } from './Cards'
import { Cover } from './Cover'

export type ShelfView = 'covers' | 'details'

/**
 * A book on a shelf: the minimal form (#100), only for whole collections
 * (your Library and profiles). Covers only, or with title, author and stars;
 * either way the title is the link's name for screen readers.
 */
export function BookTile({ entry, view = 'details' }: { entry: BookEntry; view?: ShelfView }) {
  const v = entry.value
  const label = `${v.title}, ${displayAuthors(v.authors)}`
  return (
    <Link className={`tile tile-${view}`} to={bookPath(v.hiveId)} state={{ entry }} title={view === 'covers' ? label : undefined} aria-label={view === 'covers' ? label : undefined}>
      <Cover hiveId={v.hiveId} title={v.title} authors={v.authors} entry={entry} size="fill" />
      {view === 'details' && (
        <div>
          <div className="tile-title">{v.title}</div>
          <div className="tile-author">{displayAuthors(v.authors)}</div>
          {v.status === STATUS.reading && <Progress progress={v.bookProgress} compact />}
          {v.stars ? <Stars stars={v.stars} size={13} /> : null}
        </div>
      )}
    </Link>
  )
}

/** A book you're reading: the large card, with your progress. */
export function ReadingCard({ entry }: { entry: BookEntry }) {
  const v = entry.value
  return (
    <BookCard
      book={{ hiveId: v.hiveId, title: v.title, authors: v.authors, identifiers: v.identifiers, entry }}
      state={{ entry }}
      action={null}
      context={v.bookProgress ? <Progress progress={v.bookProgress} /> : <span className="muted">No progress logged yet</span>}
    />
  )
}

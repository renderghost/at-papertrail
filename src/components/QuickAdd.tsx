import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMaybeSession } from '../lib/auth'
import { STATUS, STATUS_LABEL, type BookIdentifiers, type BookStatus, type CatalogBook } from '../lib/bookhive/types'
import { describeError } from '../lib/errors'
import { useBookWrites, useMyCopy } from '../lib/hooks'
import { bookPath } from '../lib/paths'
import { newBookRecord } from '../lib/search'
import { StatusPill } from './bits'

export type QuickBook = { hiveId: string; title: string; authors: string; identifiers?: BookIdentifiers; catalog: CatalogBook | null }

/**
 * Adds a book in one tap (series rows, "next in the series", the scanner), or
 * shows your status when it's already yours. Nothing at all when signed out.
 */
export function QuickAdd({
  book,
  statuses = [STATUS.wantToRead],
  owned = false,
  onAdded,
}: {
  book: QuickBook
  statuses?: BookStatus[]
  /** Mark the new copy as owned. */
  owned?: boolean
  onAdded?: () => void
}) {
  const me = useMaybeSession()
  const mine = useMyCopy(book)
  if (!me) return null
  if (mine) {
    return (
      <Link className="quick-mine small" to={bookPath(mine.value.hiveId)} state={{ entry: mine }}>
        <StatusPill status={mine.value.status} />
        <span className="visually-hidden">In your library</span>
      </Link>
    )
  }
  return <AddButtons book={book} statuses={statuses} owned={owned} onAdded={onAdded} />
}

function AddButtons({ book, statuses, owned, onAdded }: { book: QuickBook; statuses: BookStatus[]; owned: boolean; onAdded?: () => void }) {
  const { create } = useBookWrites()
  const [pending, setPending] = useState<BookStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const add = async (status: BookStatus) => {
    setPending(status)
    setError(null)
    try {
      const record = newBookRecord(book, book.catalog, status)
      await create.mutateAsync(owned ? { ...record, owned: true } : record)
      onAdded?.()
    } catch (err) {
      setError(describeError(err).message)
    } finally {
      setPending(null)
    }
  }
  return (
    <div className="quick-add">
      <div className="row">
        {statuses.map((s, i) => (
          <button
            key={s}
            className={`btn btn-sm${i === 0 ? ' btn-primary' : ''}`}
            disabled={pending !== null}
            onClick={() => void add(s)}
            aria-label={`${STATUS_LABEL[s]}: ${book.title}`}
          >
            {pending === s ? 'Adding…' : STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      {error && (
        <p className="small field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

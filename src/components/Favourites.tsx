import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { hiveIdForIsbn } from '../lib/bookhive/api'
import { firstAuthor } from '../lib/bookhive/authors'
import { describeError } from '../lib/errors'
import { favouriteBooks, MAX_FAVOURITES, toFavourite, type FavouriteBook, type ProfileRecord } from '../lib/favourites'
import { useMyLibrary } from '../lib/hooks'
import { bookPath } from '../lib/paths'
import { useCanWrite, usePopfeedProfile, useSaveFavourites } from '../lib/usePeople'
import { Cover } from './Cover'
import { Icon } from './Icon'
import { PermissionNote } from './Lists'

/** A favourite's hiveId: stored on ones Papertrail or BookHive wrote, looked up by ISBN for PopFeed's. */
function useFavouriteHiveId(book: FavouriteBook): string | null {
  const stored = book.identifiers.hiveId ?? null
  const isbn = book.identifiers.isbn13 ?? book.identifiers.isbn10
  const lookup = useQuery({
    queryKey: ['hive-id', isbn],
    queryFn: ({ signal }) => hiveIdForIsbn(isbn!, signal),
    enabled: !stored && !!isbn,
    staleTime: Infinity,
    retry: false,
  })
  return stored ?? lookup.data ?? null
}

function FavouriteTile({ book }: { book: FavouriteBook }) {
  const hiveId = useFavouriteHiveId(book)
  const cover = (
    <Cover
      hiveId={hiveId ?? ''}
      title={book.title}
      authors=""
      isbn13={book.identifiers.isbn13}
      fallbackUrl={typeof book.posterUrl === 'string' ? book.posterUrl : undefined}
      size="md"
    />
  )
  return (
    <li className="favourite">
      {hiveId ? (
        <Link to={bookPath(hiveId)} title={book.title}>
          {cover}
        </Link>
      ) : (
        cover
      )}
      <span className="favourite-title">{book.title}</span>
    </li>
  )
}

/** Favourite books from the reader's PopFeed profile, with an editor on your own. */
export function Favourites({ did, isMe }: { did: string; isMe: boolean }) {
  const profile = usePopfeedProfile(did)
  const [editing, setEditing] = useState(false)
  const books = favouriteBooks(profile.data ?? null)
  if (profile.isPending || profile.isError) return null
  if (books.length === 0 && !isMe) return null
  return (
    <section className="section">
      <div className="section-title">
        <h2>Favourites</h2>
        {isMe && !editing && (
          <button className="btn btn-quiet btn-sm" onClick={() => setEditing(true)}>
            {books.length ? 'Edit' : 'Choose favourites'}
          </button>
        )}
      </div>
      {editing ? (
        <FavouritesEditor profile={profile.data} current={books} onDone={() => setEditing(false)} />
      ) : books.length ? (
        <ul className="favourites">
          {books.map((b, i) => (
            <FavouriteTile key={`${b.title}-${i}`} book={b} />
          ))}
        </ul>
      ) : (
        <p className="muted">Pin up to {MAX_FAVOURITES} books you love. They're saved to your PopFeed profile, so they show there too.</p>
      )}
    </section>
  )
}

function FavouritesEditor({
  profile,
  current,
  onDone,
}: {
  profile: ProfileRecord
  current: FavouriteBook[]
  onDone: () => void
}) {
  const { allowed } = useCanWrite('profile')
  const save = useSaveFavourites()
  const library = useMyLibrary()
  const [books, setBooks] = useState(current)
  const [q, setQ] = useState('')
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (needle.length < 2) return []
    const chosen = new Set(books.map((b) => b.identifiers.hiveId).filter(Boolean))
    return (library.data ?? [])
      .filter((e) => !chosen.has(e.value.hiveId))
      .filter((e) => `${e.value.title} ${e.value.authors}`.toLowerCase().includes(needle))
      .slice(0, 6)
  }, [q, library.data, books])

  if (!allowed) return <PermissionNote scope="profile" what="favourite books" />
  const move = (i: number, by: number) =>
    setBooks((list) => {
      const next = [...list]
      const [b] = next.splice(i, 1)
      next.splice(i + by, 0, b!)
      return next
    })

  return (
    <div className="panel stack">
      {books.length > 0 && (
        <ol className="pick-list">
          {books.map((b, i) => (
            <li key={`${b.title}-${i}`}>
              <span>
                {i + 1}. <strong>{b.title}</strong>
              </span>
              <span className="row">
                <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} title={`Move ${b.title} up`}>
                  <Icon name="up" label={`Move ${b.title} up`} size={16} />
                </button>
                <button className="icon-btn" disabled={i === books.length - 1} onClick={() => move(i, 1)} title={`Move ${b.title} down`}>
                  <Icon name="down" label={`Move ${b.title} down`} size={16} />
                </button>
                <button className="btn btn-quiet btn-sm" onClick={() => setBooks((l) => l.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      {books.length < MAX_FAVOURITES && (
        <div>
          <div className="search-wrap">
            <Icon name="search" />
            <input
              className="input search-input"
              type="search"
              placeholder="Add from your library: title or author"
              aria-label="Add a favourite from your library"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {matches.length > 0 && (
            <ul className="pick-list">
              {matches.map((e) => (
                <li key={e.uri}>
                  <span>
                    <strong>{e.value.title}</strong> <span className="muted small">{firstAuthor(e.value.authors)}</span>
                  </span>
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      setBooks((l) => [...l, toFavourite({ hiveId: e.value.hiveId, title: e.value.title, identifiers: e.value.identifiers })])
                      setQ('')
                    }}
                  >
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="row">
        <button
          className="btn btn-primary btn-sm"
          disabled={save.isPending}
          onClick={() => save.mutateAsync({ profile, books }).then(onDone, () => {})}
        >
          {save.isPending ? 'Saving…' : 'Save favourites'}
        </button>
        <button className="btn btn-quiet btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
      {save.isError && (
        <div className="notice notice-error" role="alert">
          {describeError(save.error).message}
        </div>
      )}
    </div>
  )
}

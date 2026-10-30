import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Avatar, Empty, ErrorNote, Loading } from '../components/bits'
import { BookCard, CardGrid } from '../components/Cards'
import { Cover } from '../components/Cover'
import { Icon } from '../components/Icon'
import { ListsGrid, ListTags, NewListForm, PermissionNote } from '../components/Lists'
import { useMaybeSession } from '../lib/auth'
import { displayAuthors, firstAuthor } from '../lib/bookhive/authors'
import { describeError } from '../lib/errors'
import { displayName, plural } from '../lib/format'
import { useDocumentTitle, useMyLibrary, useProfile } from '../lib/hooks'
import { isPopfeedShelf, itemIsBook, listTags, parseTags, type BookList, type ListItem } from '../lib/lists'
import { bookPath, profilePath, shelfPath, shelvesPath } from '../lib/paths'
import { useListWrites, useLists } from '../lib/useLists'
import { useCanWrite } from '../lib/usePeople'

/** /shelves/:actor: someone's lists. */
export function ListsPage() {
  const { actor = '' } = useParams()
  const me = useMaybeSession()
  const profile = useProfile(actor)
  const lists = useLists(profile.data?.did)
  const isMe = !!me && profile.data?.did === me.did
  const { allowed } = useCanWrite('lists')
  useDocumentTitle(profile.data ? `Lists by ${displayName(profile.data)}` : undefined)

  if (profile.isPending) return <Loading />
  if (profile.isError) return <ErrorNote error={profile.error} />
  const p = profile.data
  return (
    <>
      <div className="page-header">
        <div className="row" style={{ gap: 16, alignItems: 'center' }}>
          <Avatar profile={p} size={56} />
          <div>
            <p className="kicker">{isMe ? 'Your lists' : 'Lists'}</p>
            <h1>{isMe ? 'Your lists' : `Lists by ${displayName(p)}`}</h1>
            <p className="muted">
              <Link to={profilePath(p.handle)}>@{p.handle}</Link>
              {lists.data ? ` · ${plural(lists.data.length, 'list')}` : ''}
            </p>
          </div>
        </div>
      </div>
      <section className="section">
        {lists.isPending ? (
          <Loading>Reading lists…</Loading>
        ) : lists.isError ? (
          <ErrorNote error={lists.error} />
        ) : lists.data.length === 0 ? (
          <Empty title="No lists yet">
            <p>
              {isMe
                ? 'Lists are saved on your PDS in the same format as BookHive and PopFeed, so they show up there too.'
                : `${displayName(p)} hasn't made any book lists on BookHive or PopFeed.`}
            </p>
          </Empty>
        ) : (
          <ListsGrid lists={lists.data} owner={p.handle} />
        )}
      </section>
      {isMe && (
        <section className="section">
          <div className="section-title">
            <h2>New list</h2>
          </div>
          {allowed ? <NewListForm /> : <PermissionNote scope="lists" what="lists" />}
        </section>
      )}
    </>
  )
}

/** /shelves/:actor/:rkey: one list. */
export function ListPage() {
  const { actor = '', rkey = '' } = useParams()
  const me = useMaybeSession()
  const profile = useProfile(actor)
  const lists = useLists(profile.data?.did)
  const list = lists.data?.find((l) => l.rkey === rkey)
  const isMe = !!me && profile.data?.did === me.did
  const editable = isMe && !!list && !isPopfeedShelf(list)
  useDocumentTitle(list?.value.name)

  if (profile.isPending || lists.isPending) return <Loading />
  if (profile.isError) return <ErrorNote error={profile.error} />
  if (lists.isError) return <ErrorNote error={lists.error} />
  const p = profile.data
  if (!list) {
    return (
      <Empty title="This list isn't here">
        <p>It may have been deleted.</p>
        <Link className="btn" to={shelvesPath(p.handle)}>
          Lists by {displayName(p)}
        </Link>
      </Empty>
    )
  }
  return editable ? <EditableList list={list} handle={p.handle} /> : <ListView list={list} owner={p} isPopfeed={isPopfeedShelf(list)} />
}

function ListHeader({
  list,
  owner,
  kicker,
  children,
}: {
  list: BookList
  owner: { handle: string; displayName?: string }
  kicker: string
  children?: React.ReactNode
}) {
  const [copied, setCopied] = useState(false)
  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard unavailable; the address bar still has the link.
    }
  }
  return (
    <div className="page-header">
      <div>
        <p className="kicker">{kicker}</p>
        <h1>{list.value.name}</h1>
        {list.value.description && <p className="lede">{list.value.description}</p>}
        <p className="muted small" style={{ marginTop: 8 }}>
          by <Link to={profilePath(owner.handle)}>{displayName(owner)}</Link> · {plural(list.items.length, 'book')}
          {list.value.ordered ? ' · ranked' : ''}
        </p>
        <ListTags list={list} />
      </div>
      <div className="row">
        {children}
        <button className="btn btn-sm btn-quiet" onClick={() => void share()}>
          {copied ? 'Link copied' : 'Copy link'}
        </button>
      </div>
    </div>
  )
}

/** A book on a list, as a card (#100): ranked on an ordered list, with the list's note for it. */
function ItemCard({ item, rank }: { item: ListItem; rank?: number }) {
  const v = item.value
  const hiveId = v.identifiers.hiveId
  const title = v.title ?? 'Untitled'
  const context = (rank !== undefined || v.description) && (
    <>
      {rank !== undefined && <p className="list-rank">No. {rank}</p>}
      {v.description && <p className="list-note">{v.description}</p>}
    </>
  )
  if (!hiveId) {
    return (
      <article className="card book-card book-card-large">
        <Cover hiveId="" title={title} authors={v.mainCredit ?? ''} isbn13={v.identifiers.isbn13} fallbackUrl={v.posterUrl} size="sm" />
        <div className="card-body">
          <h3 className="card-title">{title}</h3>
          {v.mainCredit && <p className="card-sub">{displayAuthors(v.mainCredit)}</p>}
          {context && <div className="card-context">{context}</div>}
        </div>
      </article>
    )
  }
  return (
    <BookCard
      book={{ hiveId, title, authors: v.mainCredit ?? '', identifiers: { isbn13: v.identifiers.isbn13, isbn10: v.identifiers.isbn10 }, coverUrl: v.posterUrl }}
      context={context || undefined}
    />
  )
}

function ItemCards({ list }: { list: BookList }) {
  return (
    <CardGrid size="list" className="list-items" label={list.value.name}>
      {list.items.map((item, i) => (
        <ItemCard key={item.uri} item={item} rank={list.value.ordered ? i + 1 : undefined} />
      ))}
    </CardGrid>
  )
}

function ListView({ list, owner, isPopfeed }: { list: BookList; owner: { handle: string; displayName?: string }; isPopfeed: boolean }) {
  return (
    <>
      <ListHeader list={list} owner={owner} kicker={isPopfeed ? 'PopFeed shelf' : 'List'} />
      {list.items.length === 0 ? (
        <Empty title="Nothing on this list yet" />
      ) : (
        <ItemCards list={list} />
      )}
      {isPopfeed && <p className="muted small section">PopFeed keeps this shelf in step with your PopFeed reading; edit it there.</p>}
    </>
  )
}

function EditableList({ list, handle }: { list: BookList; handle: string }) {
  const navigate = useNavigate()
  const { allowed } = useCanWrite('lists')
  const writes = useListWrites()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(list.value.name)
  const [description, setDescription] = useState(list.value.description ?? '')
  const [ordered, setOrdered] = useState(!!list.value.ordered)
  const storedTags = listTags(list.value).join(', ')
  const [tags, setTags] = useState(storedTags)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [arranging, setArranging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(describeError(err).message)
    }
  }

  const move = (index: number, by: number) => {
    const uris = list.items.map((i) => i.uri)
    const [moved] = uris.splice(index, 1)
    uris.splice(index + by, 0, moved!)
    void run(() => writes.reorder.mutateAsync({ list, uris }))
  }
  const pending = writes.update.isPending || writes.reorder.isPending || writes.removeItem.isPending || writes.add.isPending

  return (
    <>
      <ListHeader list={list} owner={{ handle }} kicker="Your list">
        {allowed && !editing && (
          <button className="btn btn-sm" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
        {allowed && list.items.length > 0 && (
          <button className="btn btn-sm" aria-pressed={arranging} onClick={() => setArranging((a) => !a)}>
            {arranging ? 'Done' : 'Edit books'}
          </button>
        )}
      </ListHeader>
      {!allowed && <PermissionNote scope="lists" what="changes to your lists" />}
      {editing && (
        <form
          className="panel stack"
          onSubmit={(e) => {
            e.preventDefault()
            void run(async () => {
              const patch = { name: name.trim() || list.value.name, description: description.trim(), ordered }
              // Tags are rewritten only when edited, so a list tagged elsewhere keeps its own.
              await writes.update.mutateAsync({ list, patch: tags === storedTags ? patch : { ...patch, tags: parseTags(tags) } })
              setEditing(false)
            })
          }}
        >
          <div className="field">
            <label htmlFor="edit-name">Name</label>
            <input id="edit-name" className="input" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="edit-description">Description</label>
            <textarea id="edit-description" className="input" rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="edit-tags">Tags (separated by commas)</label>
            <input id="edit-tags" className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={ordered} onChange={(e) => setOrdered(e.target.checked)} /> Ranked (in a set order)
          </label>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="row">
              <button className="btn btn-primary btn-sm" type="submit" disabled={writes.update.isPending}>
                Save
              </button>
              <button className="btn btn-quiet btn-sm" type="button" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
            {confirmDelete ? (
              <div className="row">
                <span className="small">Delete this list and its {plural(list.items.length, 'entry', 'entries')}?</span>
                <button
                  className="btn btn-sm btn-danger"
                  type="button"
                  onClick={() =>
                    void run(async () => {
                      await writes.remove.mutateAsync(list)
                      navigate(shelvesPath(handle), { replace: true })
                    })
                  }
                >
                  Delete
                </button>
                <button className="btn btn-quiet btn-sm" type="button" onClick={() => setConfirmDelete(false)}>
                  Keep
                </button>
              </div>
            ) : (
              <button className="btn btn-quiet btn-sm" type="button" onClick={() => setConfirmDelete(true)}>
                Delete list
              </button>
            )}
          </div>
        </form>
      )}
      {error && <ErrorNote error={new Error(error)} />}

      {list.items.length === 0 ? (
        <Empty title="Nothing on this list yet">
          <p>Add books from your library below, or from any book's page.</p>
        </Empty>
      ) : (
        arranging ? (
          <div className="table-wrap">
            <table className="book-table list-table">
              <caption className="visually-hidden">The books on {list.value.name}: reorder them, add notes or remove them</caption>
              <thead>
                <tr>
                  {list.value.ordered && <th scope="col">No.</th>}
                  <th scope="col">Title</th>
                  <th scope="col">Author</th>
                  <th scope="col">Note</th>
                  <th scope="col">
                    <span className="visually-hidden">Changes</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((item, i) => (
                  <tr key={item.uri} className="list-item">
                    {list.value.ordered && <td className="list-rank">{i + 1}</td>}
                    <th scope="row">{item.value.identifiers.hiveId ? <Link to={bookPath(item.value.identifiers.hiveId)}>{item.value.title ?? 'Untitled'}</Link> : (item.value.title ?? 'Untitled')}</th>
                    <td>{item.value.mainCredit ? displayAuthors(item.value.mainCredit) : ''}</td>
                    <td className="list-note-cell">{item.value.description}</td>
                    <td>
                      {allowed && <ItemControls list={list} item={item} index={i} disabled={pending} onMove={move} onError={setError} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <ItemCards list={list} />
        )
      )}
      {allowed && (arranging || list.items.length === 0) && <AddFromLibrary list={list} />}
    </>
  )
}

function ItemControls({
  list,
  item,
  index,
  disabled,
  onMove,
  onError,
}: {
  list: BookList
  item: ListItem
  index: number
  disabled: boolean
  onMove: (index: number, by: number) => void
  onError: (message: string) => void
}) {
  const writes = useListWrites()
  const [noting, setNoting] = useState(false)
  const [note, setNote] = useState(item.value.description ?? '')
  const title = item.value.title ?? 'this book'
  return (
    <div className="item-controls">
      {list.value.ordered && (
        <>
          <button className="icon-btn" disabled={disabled || index === 0} onClick={() => onMove(index, -1)} title={`Move ${title} up`}>
            <Icon name="up" label={`Move ${title} up`} size={16} />
          </button>
          <button
            className="icon-btn"
            disabled={disabled || index === list.items.length - 1}
            onClick={() => onMove(index, 1)}
            title={`Move ${title} down`}
          >
            <Icon name="down" label={`Move ${title} down`} size={16} />
          </button>
        </>
      )}
      {noting ? (
        <form
          className="note-form"
          onSubmit={(e) => {
            e.preventDefault()
            writes.note.mutateAsync({ list, item, note }).then(
              () => setNoting(false),
              (err: unknown) => onError(describeError(err).message),
            )
          }}
        >
          <label className="visually-hidden" htmlFor={`note-${item.rkey}`}>
            Note for {title}
          </label>
          <textarea id={`note-${item.rkey}`} className="input" rows={2} maxLength={5000} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row">
            <button className="btn btn-sm" type="submit" disabled={writes.note.isPending}>
              Save note
            </button>
            <button className="btn btn-quiet btn-sm" type="button" onClick={() => setNoting(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button className="btn btn-quiet btn-sm" disabled={disabled} onClick={() => setNoting(true)}>
          {item.value.description ? 'Edit note' : 'Add a note'}
        </button>
      )}
      <button
        className="btn btn-quiet btn-sm"
        disabled={disabled}
        onClick={() => writes.removeItem.mutateAsync({ list, item }).catch((err: unknown) => onError(describeError(err).message))}
      >
        Remove
      </button>
    </div>
  )
}

/** Search your own library and add a book to this list. */
function AddFromLibrary({ list }: { list: BookList }) {
  const library = useMyLibrary()
  const { add } = useListWrites()
  const [q, setQ] = useState('')
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (needle.length < 2) return []
    return (library.data ?? [])
      .filter((e) => !list.items.some((i) => itemIsBook(i, e.value)))
      .filter((e) => `${e.value.title} ${e.value.authors}`.toLowerCase().includes(needle))
      .slice(0, 8)
  }, [q, library.data, list.items])

  return (
    <section className="section">
      <div className="section-title">
        <h2>Add from your library</h2>
      </div>
      <div className="search-wrap">
        <Icon name="search" />
        <input
          className="input search-input"
          type="search"
          placeholder="Title or author"
          aria-label="Search your library"
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
                disabled={add.isPending}
                onClick={() =>
                  void add.mutateAsync({
                    list,
                    book: { hiveId: e.value.hiveId, title: e.value.title, authors: e.value.authors, identifiers: e.value.identifiers },
                  })
                }
              >
                Add
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="small muted" style={{ marginTop: 8 }}>
        Or open any book and use “Add to a list”. <Link to={shelfPath(list.did, list.rkey)}>Permalink</Link>
      </p>
    </section>
  )
}

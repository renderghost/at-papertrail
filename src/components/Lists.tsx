import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { BookIdentifiers } from '../lib/bookhive/types'
import { describeError } from '../lib/errors'
import { plural } from '../lib/format'
import { isPopfeedShelf, itemIsBook, listTags, parseTags, type BookList, type ListBook } from '../lib/lists'
import type { WRITE_SCOPES } from '../lib/oauthConfig'
import { shelfPath } from '../lib/paths'
import { useListWrites, useLists } from '../lib/useLists'
import { useCanWrite } from '../lib/usePeople'
import { Cover } from './Cover'
import { Icon } from './Icon'

/** Shown instead of an editor when the session predates a scope Papertrail now asks for. */
export function PermissionNote({ scope, what }: { scope: keyof typeof WRITE_SCOPES; what: string }) {
  const { reconsent } = useCanWrite(scope)
  return (
    <div className="notice">
      <p>
        Papertrail needs your permission to save {what} to your PDS. Sign in again to allow it; you'll come straight
        back here.
      </p>
      <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={reconsent}>
        Sign in again
      </button>
    </div>
  )
}

export function ListCard({ list, owner }: { list: BookList; owner: string }) {
  const covers = list.items.slice(0, 4)
  return (
    <Link className="list-card" to={shelfPath(owner, list.rkey)}>
      <div className="list-covers" aria-hidden="true">
        {covers.length === 0 && <div className="list-covers-empty">Empty list</div>}
        {covers.map((item) => (
          <Cover
            key={item.uri}
            hiveId={item.value.identifiers.hiveId ?? ''}
            title={item.value.title ?? 'Book'}
            authors={item.value.mainCredit ?? ''}
            isbn13={item.value.identifiers.isbn13}
            fallbackUrl={item.value.posterUrl}
            size="xs"
          />
        ))}
      </div>
      <div className="list-card-body">
        <h3>{list.value.name}</h3>
        <p className="small muted">
          {plural(list.items.length, 'book')}
          {list.value.ordered ? ' · ranked' : ''}
          {isPopfeedShelf(list) ? ' · PopFeed shelf' : ''}
        </p>
        {list.value.description && <p className="small list-card-desc">{list.value.description}</p>}
        <ListTags list={list} />
      </div>
    </Link>
  )
}

export function ListsGrid({ lists, owner }: { lists: BookList[]; owner: string }) {
  return (
    <div className="list-grid">
      {lists.map((list) => (
        <ListCard key={list.uri} list={list} owner={owner} />
      ))}
    </div>
  )
}

export function ListTags({ list }: { list: BookList }) {
  const tags = listTags(list.value)
  if (!tags.length) return null
  return (
    <div className="tags list-tags">
      {tags.map((t) => (
        <span key={t} className="tag">
          {t}
        </span>
      ))}
    </div>
  )
}

/** A form for a new list; calls back with the created list. */
export function NewListForm({ onCreated, compact = false }: { onCreated?: (list: BookList) => void; compact?: boolean }) {
  const { create } = useListWrites()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [ordered, setOrdered] = useState(false)
  const [tags, setTags] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    const list = await create.mutateAsync({ name, description, ordered, tags: parseTags(tags) })
    setName('')
    setDescription('')
    setOrdered(false)
    setTags('')
    onCreated?.(list)
  }
  return (
    <form className={`new-list${compact ? ' new-list-compact' : ''}`} onSubmit={(e) => void submit(e)}>
      <div className="field">
        <label htmlFor="list-name">{compact ? 'New list' : 'Name'}</label>
        <input
          id="list-name"
          className="input"
          maxLength={100}
          placeholder="e.g. Books to press on friends"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      {!compact && (
        <>
          <div className="field">
            <label htmlFor="list-description">Description (optional)</label>
            <textarea
              id="list-description"
              className="input"
              rows={2}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="list-tags">Tags (optional, separated by commas)</label>
            <input
              id="list-tags"
              className="input"
              placeholder="e.g. cosy, winter"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={ordered} onChange={(e) => setOrdered(e.target.checked)} /> Ranked (in a
            set order)
          </label>
        </>
      )}
      <div className="row">
        <button className="btn btn-primary btn-sm" type="submit" disabled={!name.trim() || create.isPending}>
          {create.isPending ? 'Creating…' : 'Create list'}
        </button>
      </div>
      {create.isError && (
        <div className="notice notice-error" role="alert">
          {describeError(create.error).message}
        </div>
      )}
    </form>
  )
}

/** On a book page: which of your lists hold it, with one-tap add and remove. */
export function AddToList({ did, book }: { did: string; book: ListBook & { identifiers?: BookIdentifiers } }) {
  const lists = useLists(did)
  const { add, removeItem } = useListWrites()
  const { allowed } = useCanWrite('lists')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const own = (lists.data ?? []).filter((l) => !isPopfeedShelf(l))
  const holding = own.filter((l) => l.items.some((i) => itemIsBook(i, book)))

  const toggle = async (list: BookList) => {
    setBusy(list.uri)
    setError(null)
    try {
      const item = list.items.find((i) => itemIsBook(i, book))
      if (item) await removeItem.mutateAsync({ list, item })
      else await add.mutateAsync({ list, book })
    } catch (err) {
      setError(describeError(err).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="add-to-list">
      <div className="row">
        <button className="btn btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <Icon name="plus" size={14} /> {holding.length ? `On ${plural(holding.length, 'list')}` : 'Add to a list'}
        </button>
        {holding.map((l) => (
          <Link key={l.uri} className="tag" to={shelfPath(did, l.rkey)}>
            {l.value.name}
          </Link>
        ))}
      </div>
      {open && (
        <div className="panel add-to-list-panel">
          {!allowed ? (
            <PermissionNote scope="lists" what="lists" />
          ) : (
            <>
              {own.length > 0 && (
                <ul className="check-list">
                  {own.map((list) => {
                    const on = list.items.some((i) => itemIsBook(i, book))
                    return (
                      <li key={list.uri}>
                        <label className="checkbox">
                          <input type="checkbox" checked={on} disabled={busy !== null} onChange={() => void toggle(list)} />{' '}
                          {list.value.name} <span className="muted small">({list.items.length})</span>
                          {busy === list.uri && <span className="muted small"> saving…</span>}
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}
              <NewListForm compact onCreated={(list) => void toggle(list)} />
              {error && (
                <div className="notice notice-error" role="alert">
                  {error}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

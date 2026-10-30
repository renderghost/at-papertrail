import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Empty, ErrorNote, Loading, Stars, StatusPill } from '../components/bits'
import { CatalogPicker } from '../components/CatalogPicker'
import { useSession } from '../lib/auth'
import { getHiveBook, type HiveBook } from '../lib/bookhive/api'
import { displayAuthors } from '../lib/bookhive/authors'
import { fetchCatalogBook } from '../lib/bookhive/catalog'
import { deleteBook, updateBook } from '../lib/bookhive/library'
import type { BookEntry, BookRecord } from '../lib/bookhive/types'
import { describeError } from '../lib/errors'
import { choosePrimary, findDuplicates, mergeRecords, rematchQuery, rematchRecord } from '../lib/fixer'
import { formatDate, plural } from '../lib/format'
import { useDocumentTitle, useMyLibrary } from '../lib/hooks'
import { repointListItems, type BookList } from '../lib/lists'
import { createLimiter } from '../lib/pool'
import { bookPath, PATHS } from '../lib/paths'
import { useLists } from '../lib/useLists'

/** Whether BookHive's catalogue knows a hiveId: its published record, else its API. */
async function catalogued(hiveId: string): Promise<boolean> {
  if (await fetchCatalogBook(hiveId).catch(() => null)) return true
  return !!(await getHiveBook(hiveId).catch(() => null))
}

const listBook = (r: BookRecord) => ({ hiveId: r.hiveId, title: r.title, authors: r.authors, identifiers: r.identifiers })

/** Books BookHive doesn't know, and books you have twice (#60). */
export function FixPage() {
  useDocumentTitle('Fix matches')
  const { did, session } = useSession()
  const library = useMyLibrary()
  const lists = useLists(did)
  const queryClient = useQueryClient()
  const entries = useMemo(() => library.data ?? [], [library.data])
  const duplicates = useMemo(() => findDuplicates(entries), [entries])

  // A record with hiveBookUri was catalogued when it was saved; the rest are checked, six at a time.
  const unknown = entries.filter((e) => !e.value.hiveBookUri)
  const check = useQuery({
    queryKey: ['uncatalogued', did, unknown.map((e) => e.value.hiveId).sort().join(',')],
    queryFn: async () => {
      const limit = createLimiter(6)
      // Cached per book, so re-checking after a fix costs nothing for the rest.
      const flags = await Promise.all(
        unknown.map((e) =>
          limit(() => queryClient.fetchQuery({ queryKey: ['catalogued', e.value.hiveId], queryFn: () => catalogued(e.value.hiveId), staleTime: 10 * 60 * 1000 })),
        ),
      )
      return new Set(unknown.filter((_, i) => !flags[i]).map((e) => e.uri))
    },
    enabled: library.isSuccess,
    staleTime: 10 * 60 * 1000,
  })
  const uncatalogued = entries.filter((e) => check.data?.has(e.uri))

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['library', did] })
    void queryClient.invalidateQueries({ queryKey: ['lists', did] })
  }

  /** Keeps `keep`, folds the others into it, deletes them, and moves their list entries. */
  const merge = async (keep: BookEntry, others: BookEntry[]) => {
    const next = mergeRecords(keep.value, others.map((o) => o.value))
    await updateBook(session, keep, next)
    for (const other of others) await deleteBook(session, other)
    const from = new Set(others.map((o) => o.value.hiveId).filter((id) => id !== next.hiveId))
    if (from.size) await repointListItems(session, lists.data ?? [], from, listBook(next))
    refresh()
  }

  /** Points a book at the catalogue entry you chose, merging if you already have that book. */
  const rematch = async (entry: BookEntry, book: HiveBook) => {
    const twin = entries.find((e) => e.uri !== entry.uri && e.value.hiveId === book.id)
    if (twin) return merge(twin, [entry])
    const next = rematchRecord(entry.value, book)
    await updateBook(session, entry, next)
    await repointListItems(session, lists.data ?? [], new Set([entry.value.hiveId]), listBook(next))
    refresh()
  }

  return (
    <>
      <div className="page-header">
        <div>
          <p className="kicker">
            <Link to={PATHS.manage}>Manage</Link>
          </p>
          <h1>Fix matches</h1>
          <p className="lede">
            bookhive.buzz only shows books in its catalogue, and an import can leave a book in your library twice. Tidy both
            here; your reading, ratings and reviews always come along.
          </p>
        </div>
      </div>

      {library.isPending ? (
        <Loading>Reading your library…</Loading>
      ) : library.isError ? (
        <ErrorNote error={library.error} />
      ) : (
        <>
          <section className="section">
            <div className="section-title">
              <h2>Not on BookHive</h2>
              {check.data && <span className="count">{uncatalogued.length}</span>}
            </div>
            {check.isPending ? (
              <Loading>Checking {plural(unknown.length, 'book')} against BookHive's catalogue…</Loading>
            ) : check.isError ? (
              <ErrorNote error={check.error} />
            ) : uncatalogued.length === 0 ? (
              <p className="muted">Every book in your library is in BookHive's catalogue.</p>
            ) : (
              <div className="table-wrap">
                <table className="book-table fix-table">
                  <caption className="visually-hidden">Books BookHive's catalogue doesn't know: find each one to match it</caption>
                  <thead>
                    <tr>
                      <th scope="col">Title</th>
                      <th scope="col">Author</th>
                      <th scope="col">Your reading</th>
                      <th scope="col">Added</th>
                      <th scope="col">
                        <span className="visually-hidden">Fix</span>
                      </th>
                    </tr>
                  </thead>
                  {uncatalogued.map((e) => (
                    <RematchRow key={e.uri} entry={e} onPick={(book) => rematch(e, book)} />
                  ))}
                </table>
              </div>
            )}
          </section>

          <section className="section">
            <div className="section-title">
              <h2>In your library twice</h2>
              <span className="count">{duplicates.length}</span>
            </div>
            {duplicates.length === 0 ? (
              <p className="muted">No duplicates.</p>
            ) : (
              <ul className="fix-list">
                {duplicates.map((group) => (
                  <DuplicateGroup key={group.map((e) => e.uri).join()} group={group} lists={lists.data ?? []} onMerge={merge} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      {library.isSuccess && entries.length === 0 && (
        <Empty title="Nothing to fix">
          <p>
            Your library is empty. <Link to={PATHS.import}>Import one</Link> or <Link to={PATHS.search}>add a book</Link>.
          </p>
        </Empty>
      )}
    </>
  )
}

/** A book's cells in a fix table: title, author, what you did with it, and when you added it. */
function BookCells({ entry }: { entry: BookEntry }) {
  const v = entry.value
  return (
    <>
      <th scope="row" className="fix-book">
        <Link className="name" to={bookPath(v.hiveId)} state={{ entry }}>
          {v.title}
        </Link>
      </th>
      <td>{displayAuthors(v.authors)}</td>
      <td>
        <span className="fix-facts">
          <StatusPill status={v.status} />
          {v.stars ? <Stars stars={v.stars} size={13} /> : null}
          {v.finishedAt && <span>finished {formatDate(v.finishedAt)}</span>}
          {v.previousReads?.length ? <span>{plural(v.previousReads.length, 'earlier read')}</span> : null}
          {v.review?.trim() && <span>reviewed</span>}
        </span>
      </td>
      <td className="muted">{formatDate(v.createdAt)}</td>
    </>
  )
}

function RematchRow({ entry, onPick }: { entry: BookEntry; onPick: (book: HiveBook) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <tbody className="fix-item">
      <tr>
        <BookCells entry={entry} />
        <td>
          <button className="btn btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Close' : 'Find on BookHive'}
          </button>
        </td>
      </tr>
      {(open || error) && (
        <tr className="fix-picker">
          <td colSpan={5}>
            {open && (
              <CatalogPicker
                initialQuery={rematchQuery(entry.value)}
                busy={busy}
                pickLabel="Match"
                onPick={async (book) => {
                  setBusy(true)
                  setError(null)
                  try {
                    await onPick(book)
                  } catch (err) {
                    setError(describeError(err).message)
                    setBusy(false)
                  }
                }}
              />
            )}
            {error && (
              <div className="notice notice-error" role="alert">
                {error}
              </div>
            )}
          </td>
        </tr>
      )}
    </tbody>
  )
}

function DuplicateGroup({
  group,
  lists,
  onMerge,
}: {
  group: BookEntry[]
  lists: BookList[]
  onMerge: (keep: BookEntry, others: BookEntry[]) => Promise<void>
}) {
  const [keep, setKeep] = useState(() => choosePrimary(group))
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const others = group.filter((e) => e.uri !== keep.uri)
  const onLists = lists.filter((l) => l.items.some((i) => others.some((o) => o.value.hiveId === i.value.identifiers.hiveId))).length
  return (
    <li className="fix-item">
      <div className="table-wrap">
        <table className="book-table fix-table">
          <caption className="small muted">Keep which copy?</caption>
          <thead>
            <tr>
              <th scope="col">Keep</th>
              <th scope="col">Title</th>
              <th scope="col">Author</th>
              <th scope="col">Your reading</th>
              <th scope="col">Added</th>
            </tr>
          </thead>
          <tbody>
            {group.map((e) => (
              <tr key={e.uri} className={e.uri === keep.uri ? 'selected' : undefined}>
                <td className="pick">
                  <input
                    type="radio"
                    name={`keep-${group[0]!.uri}`}
                    aria-label={`Keep the copy added ${formatDate(e.value.createdAt)}`}
                    checked={e.uri === keep.uri}
                    onChange={() => setKeep(e)}
                  />
                </td>
                <BookCells entry={e} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {confirming ? (
        <div className="stack">
          <p className="small">
            The kept copy gains the others' earlier reads, rating, review and ISBNs where it has none, then{' '}
            {plural(others.length, 'other copy', 'other copies')} {others.length === 1 ? 'is' : 'are'} deleted.
            {onLists ? ` ${plural(onLists, 'list')} will point at the kept copy.` : ''}
          </p>
          <div className="row">
            <button
              className="btn btn-danger btn-sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                setError(null)
                try {
                  await onMerge(keep, others)
                } catch (err) {
                  setError(describeError(err).message)
                  setBusy(false)
                }
              }}
            >
              {busy ? 'Merging…' : 'Merge'}
            </button>
            <button className="btn btn-quiet btn-sm" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button className="btn btn-sm" onClick={() => setConfirming(true)}>
            Merge into one…
          </button>
        </div>
      )}
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
    </li>
  )
}

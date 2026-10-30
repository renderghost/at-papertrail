import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ErrorNote, Loading } from '../components/bits'
import { CatalogPicker } from '../components/CatalogPicker'
import { PermissionNote } from '../components/Lists'
import { useSession } from '../lib/auth'
import { getHiveBook, hiveIdForIsbn, searchHive } from '../lib/bookhive/api'
import { displayAuthors } from '../lib/bookhive/authors'
import { fetchCatalogBook } from '../lib/bookhive/catalog'
import { isBookStatus, STATUS_LABEL } from '../lib/bookhive/types'
import { describeError } from '../lib/errors'
import { formatDate, plural } from '../lib/format'
import { useDocumentTitle, useMyLibrary } from '../lib/hooks'
import { libraryIndex, matchAll, type MatchDeps, type RowMatch } from '../lib/import/match'
import { buildPlan, CHANGE_LABEL, summarise, type PlanItem, type Resolution } from '../lib/import/plan'
import { clearUndoLog, existingListFor, loadUndoLog, runImport, saveUndoLog, undoImport, type RunResult, type UndoLog } from '../lib/import/run'
import { ImportFileError, parseExport, SOURCE_NAME, type ImportRow, type ParsedExport } from '../lib/import/sources'
import { PATHS } from '../lib/paths'
import { useLists } from '../lib/useLists'
import { useCanWrite } from '../lib/usePeople'

const deps: MatchDeps = {
  catalogue: async (hiveId, signal, known) =>
    (await fetchCatalogBook(hiveId)) ?? (known ? ((await getHiveBook(hiveId, signal))?.book ?? null) : null),
  hiveIdForIsbn,
  search: (q, signal) => searchHive(q, { limit: 5, signal }),
}

/** Above this, an account's hourly write limit may stop an import part-way. */
const LARGE_IMPORT = 1500

type Stage = 'choose' | 'matching' | 'preview' | 'writing' | 'done'

function Bar({ done, total, label }: { done: number; total: number; label: string }) {
  const percent = total ? Math.round((done / total) * 100) : 0
  return (
    <div className="progress import-progress">
      <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={label}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <span>
        {done.toLocaleString('en-GB')} of {total.toLocaleString('en-GB')}
      </span>
    </div>
  )
}

/** Bring a Goodreads, StoryGraph or Hardcover library in (#57). */
export function ImportPage() {
  useDocumentTitle('Import your books')
  const { did, session } = useSession()
  const library = useMyLibrary()
  const lists = useLists(did)
  const listsWrite = useCanWrite('lists')
  const queryClient = useQueryClient()
  const [stage, setStage] = useState<Stage>('choose')
  const [error, setError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedExport | null>(null)
  const [matches, setMatches] = useState<Map<number, RowMatch>>(new Map())
  const [resolutions, setResolutions] = useState<Map<number, Resolution>>(new Map())
  const [shelves, setShelves] = useState<Set<string>>(new Set())
  const [withSpoilers, setWithSpoilers] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState<RunResult | null>(null)
  const [undoLog, setUndoLog] = useState<UndoLog | null>(() => loadUndoLog(did))
  const [undone, setUndone] = useState<string | null>(null)
  const onUndone = (message: string) => {
    setUndoLog(null)
    setUndone(message)
  }
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  // Reviews marked as spoilers stay out unless you include them: BookHive reviews have no spoiler flag.
  const rows = useMemo<ImportRow[]>(
    () => (parsed?.rows ?? []).map((r) => (r.extras.spoiler && !withSpoilers ? { ...r, review: undefined } : r)),
    [parsed, withSpoilers],
  )
  const plan = useMemo(() => buildPlan(rows, matches, resolutions), [rows, matches, resolutions])
  const summary = useMemo(() => summarise(plan, rows), [plan, rows])
  const shelfCounts = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>()
    for (const r of rows) {
      for (const s of r.shelves) {
        const key = s.toLowerCase()
        counts.set(key, { name: counts.get(key)?.name ?? s, count: (counts.get(key)?.count ?? 0) + 1 })
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [rows])
  const unmatched = useMemo(
    () => rows.flatMap((row) => {
      const m = matches.get(row.line)
      return m?.kind === 'unmatched' ? [{ row, suggestions: m.suggestions }] : []
    }),
    [rows, matches],
  )

  const reset = () => {
    abort.current?.abort()
    setStage('choose')
    setParsed(null)
    setMatches(new Map())
    setResolutions(new Map())
    setShelves(new Set())
    setResult(null)
  }

  const choose = async (file: File) => {
    setError(null)
    let next: ParsedExport
    try {
      next = parseExport(await file.text())
    } catch (err) {
      setError(err instanceof ImportFileError ? err.message : describeError(err).message)
      return
    }
    const controller = new AbortController()
    abort.current = controller
    setParsed(next)
    setStage('matching')
    setProgress({ done: 0, total: next.rows.length })
    try {
      const found = await matchAll(next.rows, libraryIndex(library.data ?? []), deps, {
        signal: controller.signal,
        onProgress: (done) => setProgress({ done, total: next.rows.length }),
      })
      // Books BookHive can't find are saved as they are, unless you choose otherwise.
      setResolutions(new Map([...found].filter(([, m]) => m.kind === 'unmatched').map(([line]) => [line, { book: null }])))
      setMatches(found)
      setStage('preview')
    } catch (err) {
      if (controller.signal.aborted) return
      setError(describeError(err).message)
      setStage('choose')
    }
  }

  const write = async () => {
    if (!parsed) return
    setStage('writing')
    setError(null)
    setResult(null)
    const chosen = shelfCounts.filter((s) => shelves.has(s.name)).map((s) => ({ name: s.name, existing: existingListFor(s.name, lists.data ?? []) }))
    clearUndoLog(did)
    setUndoLog(null)
    setUndone(null)
    setProgress({ done: 0, total: summary.create + summary.update })
    try {
      const res = await runImport(session, plan, listsWrite.allowed ? chosen : [], {
        source: parsed.source,
        onProgress: setProgress,
        onLog: (log) => {
          saveUndoLog(log)
          setUndoLog({ ...log })
        },
      })
      setResult(res)
    } catch (err) {
      setError(describeError(err).message)
    } finally {
      setStage('done')
      void queryClient.invalidateQueries({ queryKey: ['library', did] })
      void queryClient.invalidateQueries({ queryKey: ['lists', did] })
    }
  }

  const resolve = (line: number, resolution: Resolution) => setResolutions((m) => new Map(m).set(line, resolution))
  const actionable = summary.create + summary.update + (shelves.size ? 1 : 0)

  return (
    <>
      <div className="page-header">
        <div>
          <p className="kicker">
            <Link to={PATHS.manage}>Manage</Link>
          </p>
          <h1>Bring your books</h1>
          <p className="lede">
            Import your Goodreads, StoryGraph or Hardcover library. It only fills gaps: nothing already in your library is
            overwritten, and you see every change before anything is saved.
          </p>
        </div>
      </div>

      {stage === 'choose' && (
        <>
          {undone && (
            <div className="notice notice-ok" role="status">
              {undone}
            </div>
          )}
          {undoLog && <UndoPanel log={undoLog} onUndone={onUndone} />}
          <section className="section">
            {library.isPending ? (
              <Loading>Reading your library first…</Loading>
            ) : library.isError ? (
              <ErrorNote error={library.error} />
            ) : (
              <div className="panel stack">
                <div className="field">
                  <label htmlFor="import-file">Your export file (.csv)</label>
                  <input
                    id="import-file"
                    className="file-input"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (file) void choose(file)
                    }}
                  />
                </div>
                <p className="small muted">
                  From Goodreads, StoryGraph or Hardcover. The file is read here in your browser; only your books go to your PDS.
                  Not exported yet? <Link to={PATHS.switch}>How to export from each</Link>.
                </p>
                {error && (
                  <div className="notice notice-error" role="alert">
                    {error}
                  </div>
                )}
              </div>
            )}
            {!listsWrite.allowed && (
              <div className="section-tight">
                <PermissionNote scope="lists" what="lists" />
                <p className="small muted" style={{ marginTop: 8 }}>
                  Only needed to turn your shelves into lists. Allow it before choosing your file.
                </p>
              </div>
            )}
          </section>
        </>
      )}

      {stage === 'matching' && parsed && (
        <section className="section stack" aria-live="polite">
          <h2>Finding your books on BookHive</h2>
          <p className="muted">
            {plural(parsed.rows.length, 'book')} from {SOURCE_NAME[parsed.source]}. Books already in your library are matched
            straight away; the rest are looked up by ISBN, then by title and author.
          </p>
          <Bar done={progress.done} total={progress.total} label="Books matched" />
          <div>
            <button className="btn btn-quiet btn-sm" onClick={reset}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {stage === 'preview' && parsed && (
        <>
          <section className="section">
            <div className="section-title">
              <h2>What will happen</h2>
              <span className="count">
                {SOURCE_NAME[parsed.source]} · {plural(parsed.rows.length, 'row')}
              </span>
            </div>
            <ul className="import-summary">
              <li>
                <strong>{summary.create.toLocaleString('en-GB')}</strong>
                <span>{summary.create === 1 ? 'new book' : 'new books'}</span>
                {summary.uncatalogued > 0 && <span className="small muted">{summary.uncatalogued.toLocaleString('en-GB')} not on BookHive yet</span>}
              </li>
              <li>
                <strong>{summary.update.toLocaleString('en-GB')}</strong>
                <span>already yours, with details to fill in</span>
              </li>
              <li>
                <strong>{summary.same.toLocaleString('en-GB')}</strong>
                <span>already yours, nothing to add</span>
              </li>
            </ul>
            <ImportNotes summary={summary} skipped={parsed.skipped} spoilers={summary.spoilers} withSpoilers={withSpoilers} onSpoilers={setWithSpoilers} />
          </section>

          {unmatched.length > 0 && (
            <section className="section">
              <div className="section-title">
                <h2>Not found on BookHive</h2>
                <span className="count">{unmatched.length}</span>
              </div>
              <p className="muted">
                bookhive.buzz only shows books in its catalogue. Find each one if you can; any you leave are saved as they
                are, and you can match them later in <Link to={PATHS.fix}>Fix matches</Link>.
              </p>
              <div className="table-wrap">
                <table className="book-table unmatched-table">
                  <caption className="visually-hidden">Books from your file that BookHive's catalogue doesn't have</caption>
                  <thead>
                    <tr>
                      <th scope="col">Title</th>
                      <th scope="col">Author</th>
                      <th scope="col">Line</th>
                      <th scope="col">Will be</th>
                      <th scope="col">
                        <span className="visually-hidden">Changes</span>
                      </th>
                    </tr>
                  </thead>
                  {unmatched.map(({ row, suggestions }) => (
                    <UnmatchedRow key={row.line} row={row} suggestions={suggestions} resolution={resolutions.get(row.line)} onResolve={(r) => resolve(row.line, r)} />
                  ))}
                </table>
              </div>
            </section>
          )}

          {shelfCounts.length > 0 && (
            <section className="section">
              <div className="section-title">
                <h2>Your shelves as lists</h2>
                <span className="count">{shelfCounts.length}</span>
              </div>
              <p className="muted">Choose shelves to turn into PopFeed lists. They show on BookHive and PopFeed too.</p>
              {listsWrite.allowed ? (
                <ul className="check-list">
                  {shelfCounts.map((s) => {
                    const existing = existingListFor(s.name, lists.data ?? [])
                    return (
                      <li key={s.name}>
                        <label className="checkbox">
                          <input
                            type="checkbox"
                            checked={shelves.has(s.name)}
                            onChange={(e) =>
                              setShelves((set) => {
                                const next = new Set(set)
                                if (e.target.checked) next.add(s.name)
                                else next.delete(s.name)
                                return next
                              })
                            }
                          />{' '}
                          {s.name}{' '}
                          <span className="small muted">
                            {plural(s.count, 'book')}
                            {existing ? ` · adds to your list “${existing.value.name}”` : ''}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="small muted">Papertrail doesn't have permission to save lists. Allow it on this page before choosing your file to include them.</p>
              )}
            </section>
          )}

          <ChangeList plan={plan} />

          <section className="section stack">
            <div className="row">
              <button className="btn btn-primary" onClick={() => void write()} disabled={!actionable}>
                {summary.create || summary.update
                  ? `Import ${plural(summary.create, 'new book')}${summary.update ? ` and fill in ${summary.update.toLocaleString('en-GB')}` : ''}`
                  : 'Make the lists'}
              </button>
              <button className="btn btn-quiet" onClick={reset}>
                Choose another file
              </button>
            </div>
            <p className="small muted">
              Nothing is saved until you press Import.
              {summary.create + summary.update > LARGE_IMPORT &&
                ' Your PDS limits how many records an account can write an hour, so an import this size may stop part-way. Run it again later and it carries on.'}
            </p>
          </section>
        </>
      )}

      {stage === 'writing' && (
        <section className="section stack" aria-live="polite">
          <h2>Saving to your PDS</h2>
          <Bar done={progress.done} total={progress.total} label="Books saved" />
          <p className="small muted">If this tab closes, run the import again: it only fills gaps, so it carries on where it stopped.</p>
        </section>
      )}

      {stage === 'done' && (
        <section className="section stack">
          <h2>{error ? 'The import stopped' : result?.stoppedEarly ? 'Imported part of your library' : 'Imported'}</h2>
          {result && (
            <ul className="import-summary">
              <li>
                <strong>{result.created.toLocaleString('en-GB')}</strong>
                <span>{result.created === 1 ? 'book added' : 'books added'}</span>
              </li>
              <li>
                <strong>{result.updated.toLocaleString('en-GB')}</strong>
                <span>filled in</span>
              </li>
              {(result.listsCreated > 0 || result.itemsAdded > 0) && (
                <li>
                  <strong>{result.itemsAdded.toLocaleString('en-GB')}</strong>
                  <span>
                    added to lists{result.listsCreated ? ` (${plural(result.listsCreated, 'new list')})` : ''}
                  </span>
                </li>
              )}
            </ul>
          )}
          {result?.stoppedEarly && <div className="notice">{result.stoppedEarly}</div>}
          {result && result.stale > 0 && (
            <div className="notice">
              {plural(result.stale, 'book')} changed elsewhere while importing and {result.stale === 1 ? 'was' : 'were'} left alone. Run the import again to fill {result.stale === 1 ? 'it' : 'them'} in.
            </div>
          )}
          {error && (
            <div className="notice notice-error" role="alert">
              {error} Everything saved before this is listed below, and can be undone.
            </div>
          )}
          {summary.uncatalogued > 0 && !error && (
            <p className="muted">
              {plural(summary.uncatalogued, 'book')} {summary.uncatalogued === 1 ? "isn't" : "aren't"} on BookHive yet. <Link to={PATHS.fix}>Fix matches</Link> when you have a moment.
            </p>
          )}
          <div className="row">
            <Link className="btn btn-primary" to={PATHS.books}>
              See your books
            </Link>
            <button className="btn btn-quiet" onClick={reset}>
              Import another file
            </button>
          </div>
          {undone && (
            <div className="notice notice-ok" role="status">
              {undone}
            </div>
          )}
          {undoLog && <UndoPanel log={undoLog} onUndone={onUndone} />}
        </section>
      )}
    </>
  )
}

function ImportNotes({
  summary,
  skipped,
  spoilers,
  withSpoilers,
  onSpoilers,
}: {
  summary: ReturnType<typeof summarise>
  skipped: number
  spoilers: number
  withSpoilers: boolean
  onSpoilers: (v: boolean) => void
}) {
  const notes: string[] = []
  if (summary.rounded) notes.push(`${plural(summary.rounded, 'quarter-star rating')} will round to the nearest half star.`)
  if (summary.undatedRereads)
    notes.push(`${plural(summary.undatedRereads, 're-read')} without dates can't be recorded: earlier reads need a finish date.`)
  if (summary.moods || summary.pace || summary.contentWarnings)
    notes.push("Moods, pace and content warnings aren't imported yet: there's no shared place to keep them. Keep your file; they can come across later.")
  if (skipped) notes.push(`${plural(skipped, 'row')} had no title or author and will be skipped.`)
  if (!notes.length && !spoilers) return null
  return (
    <div className="import-notes">
      {notes.length > 0 && (
        <ul>
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {spoilers > 0 && (
        <label className="checkbox">
          <input type="checkbox" checked={withSpoilers} onChange={(e) => onSpoilers(e.target.checked)} /> Include{' '}
          {plural(spoilers, 'review')} marked as containing spoilers. BookHive reviews have no spoiler warning, so everyone would see{' '}
          {spoilers === 1 ? 'it' : 'them'}.
        </label>
      )}
    </div>
  )
}

function UnmatchedRow({
  row,
  suggestions,
  resolution,
  onResolve,
}: {
  row: ImportRow
  suggestions: Extract<RowMatch, { kind: 'unmatched' }>['suggestions']
  resolution: Resolution | undefined
  onResolve: (r: Resolution) => void
}) {
  const [open, setOpen] = useState(false)
  const chosen = resolution && resolution !== 'skip' ? resolution.book : null
  const choice = resolution === 'skip' ? 'Skipped' : chosen ? `Matched to ${chosen.title}` : 'Saved as it is'
  return (
    <tbody className="unmatched">
      <tr>
        <th scope="row">
          <strong>{row.title}</strong>
        </th>
        <td>{row.authors.join(', ')}</td>
        <td className="muted">{row.line}</td>
        <td className={chosen ? undefined : 'muted'}>{choice}</td>
        <td>
          <div className="row unmatched-actions">
            <button className="btn btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? 'Close' : 'Find on BookHive'}
            </button>
            {resolution !== undefined && resolution !== 'skip' && resolution.book && (
              <button className="btn btn-sm btn-quiet" onClick={() => onResolve({ book: null })}>
                Save as it is
              </button>
            )}
            {resolution === 'skip' ? (
              <button className="btn btn-sm btn-quiet" onClick={() => onResolve({ book: null })}>
                Don't skip
              </button>
            ) : (
              <button className="btn btn-sm btn-quiet" onClick={() => onResolve('skip')}>
                Skip this book
              </button>
            )}
          </div>
        </td>
      </tr>
      {open && (
        <tr className="fix-picker">
          <td colSpan={5}>
            <CatalogPicker
              initialQuery={`${row.bareTitle} ${row.authors[0] ?? ''}`.trim()}
              suggestions={suggestions}
              chosenId={chosen?.id}
              onPick={(book) => {
                onResolve({ book })
                setOpen(false)
              }}
            />
          </td>
        </tr>
      )}
    </tbody>
  )
}

function describe(item: PlanItem): string {
  if (item.kind === 'create') {
    const r = item.record
    return [
      'New',
      isBookStatus(r.status) ? STATUS_LABEL[r.status] : null,
      r.stars ? `${r.stars / 2} stars` : null,
      r.finishedAt ? `finished ${formatDate(r.finishedAt)}` : null,
      item.catalogued ? null : 'not on BookHive yet',
    ]
      .filter(Boolean)
      .join(' · ')
  }
  if (item.kind === 'update') return `Adds ${item.changes.map((c) => CHANGE_LABEL[c]).join(', ')}`
  return ''
}

function ChangeList({ plan }: { plan: PlanItem[] }) {
  const changes = plan.filter((p): p is PlanItem & { kind: 'create' | 'update' } => p.kind === 'create' || p.kind === 'update')
  if (!changes.length) return null
  return (
    <details className="section change-details">
      <summary>See every change ({changes.length.toLocaleString('en-GB')})</summary>
      <div className="table-wrap change-list">
        <table className="book-table">
          <caption className="visually-hidden">Every change the import will make</caption>
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Author</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((p) => {
              const value = p.kind === 'create' ? p.record : p.next
              return (
                <tr key={p.kind === 'create' ? `c${p.rows[0]!.line}` : p.entry.uri}>
                  <th scope="row">{value.title}</th>
                  <td>{displayAuthors(value.authors)}</td>
                  <td>{describe(p)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function UndoPanel({ log, onUndone }: { log: UndoLog; onUndone: (message: string) => void }) {
  const { did, session } = useSession()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [stopped, setStopped] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const count = (part: string) => log.created.filter((uri) => uri.includes(`/${part}/`)).length
  const books = count('buzz.bookhive.book')
  const madeLists = count('social.popfeed.feed.list')
  const items = count('social.popfeed.feed.listItem')
  if (!books && !madeLists && !items && !log.updated.length) return null

  const undo = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await undoImport(session, log)
      if (res.stoppedEarly) setStopped(res.stoppedEarly)
      else {
        clearUndoLog(did)
        onUndone(
          `Undone: ${plural(res.deleted, 'record')} removed and ${plural(res.restored, 'record')} restored.${res.skipped ? ` ${plural(res.skipped, 'record')} changed since and ${res.skipped === 1 ? 'was' : 'were'} left alone.` : ''}`,
        )
      }
    } catch (err) {
      setError(describeError(err).message)
    } finally {
      setBusy(false)
      void queryClient.invalidateQueries({ queryKey: ['library', did] })
      void queryClient.invalidateQueries({ queryKey: ['lists', did] })
    }
  }

  return (
    <div className="panel stack undo-panel">
      <p>
        <strong>Your last import</strong>, from {SOURCE_NAME[log.source]} on {formatDate(log.at)}: {plural(books, 'book')} added,{' '}
        {plural(log.updated.length, 'record')} filled in{madeLists || items ? `, ${plural(items, 'list entry', 'list entries')} added` : ''}.
      </p>
      {confirming ? (
        <>
          <p className="small">
            Undo removes what that import added and puts back what it filled in. Anything you've changed since is left alone.
          </p>
          <div className="row">
            <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => void undo()}>
              {busy ? 'Undoing…' : 'Undo the import'}
            </button>
            <button className="btn btn-quiet btn-sm" disabled={busy} onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </div>
        </>
      ) : (
        <div>
          <button className="btn btn-sm" onClick={() => setConfirming(true)}>
            Undo this import…
          </button>
        </div>
      )}
      {stopped && <div className="notice">{stopped}</div>}
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}

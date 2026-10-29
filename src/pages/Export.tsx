import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ErrorNote, Loading } from '../components/bits'
import { useSession } from '../lib/auth'
import { describeError } from '../lib/errors'
import { download, exportRecords, goodreadsCsv } from '../lib/export'
import { plural } from '../lib/format'
import { useDocumentTitle, useMyLibrary } from '../lib/hooks'
import { useLists } from '../lib/useLists'

const today = () => new Date().toISOString().slice(0, 10)

/** Take your data anywhere (#58), made in the browser. */
export function ExportPage() {
  useDocumentTitle('Export your library')
  const { did, session } = useSession()
  const library = useMyLibrary()
  const lists = useLists(did)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const name = session.handle.replace(/[^a-z0-9.-]/gi, '')

  const saveJson = async () => {
    setBusy(true)
    setError(null)
    setSaved(null)
    try {
      const data = await exportRecords(did, session.handle)
      const count = Object.values(data.collections).reduce((n, r) => n + r.length, 0)
      download(`papertrail-${name}-${today()}.json`, JSON.stringify(data, null, 2), 'application/json')
      setSaved(`Saved ${plural(count, 'record')} from ${plural(Object.keys(data.collections).length, 'collection')}.`)
    } catch (err) {
      setError(describeError(err).message)
    } finally {
      setBusy(false)
    }
  }

  const saveCsv = () => {
    const books = (library.data ?? []).map((e) => e.value)
    download(`papertrail-${name}-${today()}-goodreads.csv`, goodreadsCsv(books, lists.data ?? []), 'text/csv;charset=utf-8')
    setSaved(`Saved ${plural(books.length, 'book')} as a Goodreads CSV.`)
  }

  return (
    <>
      <div className="page-header">
        <div>
          <p className="kicker">Your library</p>
          <h1>Take it with you</h1>
          <p className="lede">
            Your books already live on your own PDS, so they go wherever you go. These files are for backups, spreadsheets
            and other apps.
          </p>
        </div>
      </div>

      {library.isPending ? (
        <Loading>Reading your library…</Loading>
      ) : library.isError ? (
        <ErrorNote error={library.error} />
      ) : (
        <div className="export-options">
          <section className="panel stack">
            <h2>Goodreads CSV</h2>
            <p className="muted">
              {plural(library.data.length, 'book')} in Goodreads' own layout, which Goodreads and StoryGraph both import.
            </p>
            <ul className="small muted">
              <li>Half stars round down: Goodreads only takes whole stars.</li>
              <li>Your lists become shelves, and abandoned books go on a "did-not-finish" shelf.</li>
              <li>Each book's earlier reads count towards its Read Count; Goodreads keeps only the latest date.</li>
            </ul>
            <div>
              <button className="btn btn-primary" onClick={saveCsv} disabled={!library.data.length}>
                Download CSV
              </button>
            </div>
          </section>

          <section className="panel stack">
            <h2>Your exact records (JSON)</h2>
            <p className="muted">
              Every record in your BookHive and PopFeed collections, exactly as stored: books, comments, lists, favourites and
              anything else those apps keep on your PDS.
            </p>
            <div>
              <button className="btn" onClick={() => void saveJson()} disabled={busy}>
                {busy ? 'Reading your PDS…' : 'Download JSON'}
              </button>
            </div>
          </section>

          <section className="panel stack">
            <h2>Everything on your PDS</h2>
            <p className="muted">
              Your whole repository, Bluesky posts included, as a CAR file: the format PDSes use to move accounts.
            </p>
            <div>
              <a className="btn" href={`${session.pds.replace(/\/$/, '')}/xrpc/com.atproto.sync.getRepo?did=${encodeURIComponent(did)}`} download>
                Download repository
              </a>
            </div>
          </section>
        </div>
      )}
      {saved && (
        <div className="notice notice-ok section-tight" role="status">
          {saved}
        </div>
      )}
      {error && (
        <div className="notice notice-error section-tight" role="alert">
          {error}
        </div>
      )}
      <p className="small muted section">
        Coming the other way? <Link to="/import">Import from Goodreads, StoryGraph or Hardcover</Link>.
      </p>
    </>
  )
}

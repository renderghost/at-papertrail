import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Stars, StatusPill } from '../components/bits'
import { Cover } from '../components/Cover'
import { QuickAdd } from '../components/QuickAdd'
import { useSession } from '../lib/auth'
import { displayAuthors } from '../lib/bookhive/authors'
import { applyPatch } from '../lib/bookhive/library'
import { STATUS, STATUS_LABEL, type BookEntry, type BookStatus } from '../lib/bookhive/types'
import { describeError } from '../lib/errors'
import { plural } from '../lib/format'
import { useBookWrites, useDocumentTitle, useMyCopy } from '../lib/hooks'
import { bookKeys, libraryIndex } from '../lib/import/match'
import { parseIsbn } from '../lib/isbn'
import { useNetwork } from '../lib/network'
import { bookPath } from '../lib/paths'
import { bookCodes, createDetector, lookupIsbn, type Detector, type ScannedBook } from '../lib/scanner'
import { newBookRecord } from '../lib/search'
import { NetworkReaders } from './BookPage'

type Mode = 'add' | 'shelf' | 'shop'

const MODES: { key: Mode; label: string; hint: string }[] = [
  { key: 'add', label: 'Add a book', hint: 'Scan a book, choose a status, done.' },
  { key: 'shelf', label: 'Shelf mode', hint: 'Scan a stack in a row: each book is added as owned, or marked as owned if you have it.' },
  { key: 'shop', label: 'Bookshop', hint: "Do you have it, and what did people you follow think? Nothing is added unless you choose." },
]

type CameraState = 'idle' | 'starting' | 'live' | 'denied' | 'nocamera' | 'unsupported' | 'nodecoder' | 'error'

const CAMERA_PROBLEM: Partial<Record<CameraState, string>> = {
  denied: 'Camera access was blocked. Allow it for this site in your browser settings, or type the ISBN below.',
  nocamera: "This device doesn't seem to have a camera. Type the ISBN below instead.",
  unsupported: "This browser can't use the camera here. Type the ISBN below instead.",
  nodecoder: "Barcode reading isn't available in this browser. Type the ISBN below instead.",
  error: "The camera couldn't start. Type the ISBN below instead.",
}

/**
 * The camera and a detection loop. Frames are read on this device and never
 * uploaded. `onCode` gets each book ISBN seen while `active` is true.
 */
function useCamera(onCode: (isbn: string) => void, active: boolean) {
  const video = useRef<HTMLVideoElement | null>(null)
  const [state, setState] = useState<CameraState>('idle')
  const [detector, setDetector] = useState<Detector['kind'] | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const live = useRef({ onCode, active })
  live.current = { onCode, active }

  const stop = useCallback(() => {
    window.clearTimeout(timer.current)
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    if (video.current) video.current.srcObject = null
  }, [])
  useEffect(() => stop, [stop])

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) return setState('unsupported')
    setState('starting')
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      stream.current = media
      const el = video.current!
      el.srcObject = media
      await el.play()
      let d: Detector
      try {
        d = await createDetector()
      } catch {
        stop()
        return setState('nodecoder')
      }
      setDetector(d.kind)
      setState('live')
      const tick = async () => {
        if (!stream.current) return
        if (live.current.active) {
          try {
            const [isbn] = bookCodes(await d.detect(el))
            if (isbn) live.current.onCode(isbn)
          } catch {
            // A frame that can't be read; try the next.
          }
        }
        timer.current = window.setTimeout(() => void tick(), 200)
      }
      void tick()
    } catch (err) {
      stop()
      const name = (err as { name?: string }).name
      setState(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'nocamera' : 'error')
    }
  }

  return { video, state, detector, start, stop }
}

/** Scan a book's barcode to add it, catalogue a shelf, or check it in a bookshop (#59). */
export function ScanPage() {
  useDocumentTitle('Scan a book')
  const [params, setParams] = useSearchParams()
  const mode = (MODES.find((m) => m.key === params.get('mode'))?.key ?? 'add') as Mode
  const [found, setFound] = useState<{ isbn: string; book: ScannedBook | null; error?: string } | null>(null)
  const [looking, setLooking] = useState<string | null>(null)
  const shelf = useShelfMode()
  const last = useRef({ isbn: '', at: 0 })

  const handle = useCallback(
    async (isbn: string) => {
      // The same barcode stays in view for a while; act on it once.
      const now = Date.now()
      if (isbn === last.current.isbn && now - last.current.at < 4000) return
      last.current = { isbn, at: now }
      navigator.vibrate?.(40)
      if (mode === 'shelf') return shelf.scan(isbn)
      setLooking(isbn)
      setFound(null)
      try {
        setFound({ isbn, book: await lookupIsbn(isbn) })
      } catch (err) {
        setFound({ isbn, book: null, error: describeError(err).message })
      } finally {
        setLooking(null)
      }
    },
    [mode, shelf],
  )
  // Add and bookshop modes pause on a result until you scan the next one.
  const scanning = mode === 'shelf' || (!found && !looking)
  const camera = useCamera((isbn) => void handle(isbn), scanning)

  const next = () => {
    setFound(null)
    last.current = { isbn: '', at: 0 }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <p className="kicker">Your library</p>
          <h1>Scan a book</h1>
          <p className="lede">Point your camera at the barcode on the back. Frames are read on this device, never uploaded.</p>
        </div>
      </div>

      <div className="chips scan-modes" role="tablist" aria-label="Scanning mode">
        {MODES.map((m) => (
          <button
            key={m.key}
            role="tab"
            className="chip"
            aria-selected={mode === m.key}
            onClick={() => {
              setParams(m.key === 'add' ? {} : { mode: m.key }, { replace: true })
              next()
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="muted small">{MODES.find((m) => m.key === mode)!.hint}</p>

      <div className="scan-layout">
        <div className="scan-camera">
          <div className={`viewfinder viewfinder-${camera.state}`} data-detector={camera.detector ?? undefined}>
            <video ref={camera.video} playsInline muted aria-label="Camera view" />
            {camera.state === 'live' && <div className="viewfinder-guide" aria-hidden="true" />}
            {camera.state !== 'live' && (
              <div className="viewfinder-overlay">
                {camera.state === 'starting' ? (
                  <p>Starting the camera…</p>
                ) : CAMERA_PROBLEM[camera.state] ? (
                  <p>{CAMERA_PROBLEM[camera.state]}</p>
                ) : (
                  <button className="btn btn-primary" onClick={() => void camera.start()}>
                    Start the camera
                  </button>
                )}
              </div>
            )}
          </div>
          <p className="small muted scan-status" role="status">
            {camera.state === 'live'
              ? looking
                ? `Looking up ${looking}…`
                : scanning
                  ? 'Looking for a barcode…'
                  : 'Paused'
              : ''}
          </p>
          <ManualIsbn onIsbn={(isbn) => void handle(isbn)} />
        </div>

        <div className="scan-result" aria-live="polite">
          {mode === 'shelf' ? (
            <ShelfList shelf={shelf} />
          ) : found ? (
            <ScanResult key={found.isbn} mode={mode} found={found} onNext={next} />
          ) : (
            !looking && <p className="muted">{camera.state === 'live' ? 'Hold a barcode inside the frame.' : 'Start the camera, or type an ISBN.'}</p>
          )}
        </div>
      </div>
    </>
  )
}

function ManualIsbn({ onIsbn }: { onIsbn: (isbn: string) => void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const isbn = parseIsbn(text)
    if (!isbn) return setError("That isn't a valid ISBN. Check the 10 or 13 digits.")
    setError(null)
    setText('')
    onIsbn(isbn)
  }
  return (
    <form className="manual-isbn" onSubmit={submit} noValidate>
      <label htmlFor="isbn-input" className="small">
        Or type the ISBN
      </label>
      <div className="row">
        <input
          id="isbn-input"
          className="input"
          inputMode="numeric"
          autoComplete="off"
          placeholder="978…"
          value={text}
          aria-invalid={!!error}
          aria-describedby={error ? 'isbn-error' : undefined}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn" type="submit">
          Look up
        </button>
      </div>
      {error && (
        <p id="isbn-error" className="field-error">
          {error}
        </p>
      )}
    </form>
  )
}

function BookCard({ book }: { book: ScannedBook }) {
  return (
    <div className="scan-book">
      <Cover hiveId={book.hiveId} title={book.title} authors={book.authors} isbn13={book.isbn} fallbackUrl={book.coverUrl} size="md" />
      <div>
        <h2>{book.title}</h2>
        <p className="muted">{displayAuthors(book.authors)}</p>
        <p className="small muted">
          ISBN {book.isbn}
          {book.catalog ? ' · On BookHive' : " · Not in BookHive's catalogue yet"}
        </p>
        {book.catalog?.rating ? (
          <p className="small">
            <Stars stars={Math.round(book.catalog.rating / 500)} size={13} /> {(book.catalog.rating / 1000).toFixed(2)} average
            {book.catalog.ratingsCount ? ` from ${plural(book.catalog.ratingsCount, 'rating')}` : ''}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function ScanResult({ mode, found, onNext }: { mode: Mode; found: { isbn: string; book: ScannedBook | null; error?: string }; onNext: () => void }) {
  const { did } = useSession()
  const network = useNetwork(mode === 'shop' ? did : undefined)
  const mine = useMyCopy(found.book)
  const [owned, setOwned] = useState(false)
  const { book } = found
  return (
    <div className="stack">
      {!book ? (
        <div className="notice">
          {found.error ?? `Nobody seems to know ISBN ${found.isbn}: not BookHive, Open Library or Google Books.`}{' '}
          <Link to={`/add?q=${found.isbn}`}>Search by title instead</Link>.
        </div>
      ) : (
        <>
          <BookCard book={book} />
          {mine ? (
            <div className="row">
              <span>In your library:</span>
              <StatusPill status={mine.value.status} />
              {mine.value.stars ? <Stars stars={mine.value.stars} size={14} /> : null}
              {mine.value.owned && <span className="small muted">owned</span>}
              <Link className="btn btn-sm" to={bookPath(mine.value.hiveId)} state={{ entry: mine }}>
                Open
              </Link>
            </div>
          ) : (
            <>
              {mode === 'shop' && <p className="muted">Not in your library.</p>}
              {mode === 'add' && (
                <label className="checkbox">
                  <input type="checkbox" checked={owned} onChange={(e) => setOwned(e.target.checked)} /> I own a copy
                </label>
              )}
              <QuickAdd
                book={book}
                statuses={mode === 'shop' ? [STATUS.wantToRead] : [STATUS.wantToRead, STATUS.reading, STATUS.finished]}
                owned={mode === 'add' && owned}
              />
            </>
          )}
          {mode === 'shop' && (
            <NetworkReaders
              did={did}
              readers={network.readers}
              entry={mine}
              hiveId={book.hiveId}
              identifiers={{ ...book.identifiers, hiveId: book.hiveId }}
              loading={network.status === 'loading'}
            />
          )}
          {mode === 'shop' && <Link to={bookPath(book.hiveId)}>Everything about this book</Link>}
        </>
      )}
      <div>
        <button className="btn btn-primary" onClick={onNext}>
          Scan another
        </button>
      </div>
    </div>
  )
}

type ShelfItem = {
  isbn: string
  state: 'looking' | 'added' | 'owned' | 'already' | 'missing' | 'error' | 'undone'
  book?: ScannedBook
  entry?: BookEntry
  /** Shelf mode added this copy, or marked it owned. */
  error?: string
}

const SHELF_STATE: Record<ShelfItem['state'], string> = {
  looking: 'Looking it up…',
  added: 'Added as owned',
  owned: 'Marked as owned',
  already: 'Already owned',
  missing: 'Not found',
  error: "Couldn't save",
  undone: 'Undone',
}

/** Shelf mode: every scan is added as owned, or marked owned if you already have it. */
function useShelfMode() {
  const { did } = useSession()
  const queryClient = useQueryClient()
  const { create, update, remove } = useBookWrites()
  const [items, setItems] = useState<ShelfItem[]>([])
  const [status, setStatus] = useState<BookStatus>(STATUS.wantToRead)
  const seen = useRef(new Set<string>())
  const statusRef = useRef(status)
  statusRef.current = status

  const set = (isbn: string, patch: Partial<ShelfItem>) => setItems((list) => list.map((i) => (i.isbn === isbn ? { ...i, ...patch } : i)))

  const scan = useCallback(
    async (isbn: string) => {
      if (seen.current.has(isbn)) return
      seen.current.add(isbn)
      setItems((list) => [{ isbn, state: 'looking' }, ...list])
      try {
        const book = await lookupIsbn(isbn)
        if (!book) return set(isbn, { state: 'missing' })
        // The library as it is now, including books this session just added.
        const index = libraryIndex(queryClient.getQueryData<BookEntry[]>(['library', did]) ?? [])
        const existing = bookKeys(book).map((k) => index.get(k)).find(Boolean)
        if (existing?.value.owned) return set(isbn, { state: 'already', book, entry: existing })
        if (existing) {
          const entry = await update.mutateAsync({ entry: existing, next: applyPatch(existing.value, { owned: true }) })
          return set(isbn, { state: 'owned', book, entry })
        }
        // A book from your shelf was read some time, not today: no reading dates are stamped.
        const { startedAt: _started, finishedAt: _finished, ...record } = newBookRecord(book, book.catalog, statusRef.current)
        const entry = await create.mutateAsync({ ...record, owned: true })
        set(isbn, { state: 'added', book, entry })
      } catch (err) {
        seen.current.delete(isbn)
        set(isbn, { state: 'error', error: describeError(err).message })
      }
    },
    [did, queryClient, create, update],
  )

  const undo = async (item: ShelfItem) => {
    if (!item.entry) return
    try {
      if (item.state === 'added') await remove.mutateAsync(item.entry)
      else if (item.state === 'owned') await update.mutateAsync({ entry: item.entry, next: applyPatch(item.entry.value, { owned: null }) })
      seen.current.delete(item.isbn)
      set(item.isbn, { state: 'undone' })
    } catch (err) {
      set(item.isbn, { error: describeError(err).message })
    }
  }

  return { items, status, setStatus, scan, undo }
}

function ShelfList({ shelf }: { shelf: ReturnType<typeof useShelfMode> }) {
  const counts = (s: ShelfItem['state']) => shelf.items.filter((i) => i.state === s).length
  return (
    <div className="stack">
      <label className="row small">
        <span>New books go on</span>
        <select className="select" style={{ width: 'auto' }} value={shelf.status} onChange={(e) => shelf.setStatus(e.target.value as BookStatus)}>
          {[STATUS.wantToRead, STATUS.finished].map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      {shelf.items.length === 0 ? (
        <p className="muted">Scan your books one after another; they'll appear here.</p>
      ) : (
        <>
          <p className="small">
            {plural(shelf.items.length, 'book')} scanned · {counts('added')} added · {counts('owned')} marked owned
            {counts('already') ? ` · ${counts('already')} already owned` : ''}
            {counts('missing') ? ` · ${counts('missing')} not found` : ''}
          </p>
          <ul className="shelf-scans">
            {shelf.items.map((item) => (
              <li key={item.isbn} className={`shelf-scan shelf-scan-${item.state}`}>
                {item.book ? (
                  <Cover hiveId={item.book.hiveId} title={item.book.title} authors={item.book.authors} isbn13={item.isbn} fallbackUrl={item.book.coverUrl} size="xs" />
                ) : (
                  <span className="cover-blank" aria-hidden="true" />
                )}
                <div className="shelf-scan-body">
                  <strong>{item.book?.title ?? item.isbn}</strong>
                  <span className="small muted">
                    {item.book ? `${displayAuthors(item.book.authors)} · ` : ''}
                    {SHELF_STATE[item.state]}
                    {item.error ? `: ${item.error}` : ''}
                  </span>
                </div>
                {(item.state === 'added' || item.state === 'owned') && (
                  <button className="btn btn-sm btn-quiet" onClick={() => void shelf.undo(item)}>
                    Undo
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

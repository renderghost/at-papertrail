import { useQueries } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { fetchCatalogBook } from '../lib/bookhive/catalog'
import type { BookEntry, CatalogBook } from '../lib/bookhive/types'
import { computeCovered, MONTHS, periodLabel, periodRange, readsIn, type CoveredStats, type Period, type Read } from '../lib/covered'
import { formatDate, plural } from '../lib/format'
import { Stars } from './bits'
import { Cover } from './Cover'
import { Icon } from './Icon'

type Slide = { key: string; theme: string; body: ReactNode }

function CoverOf({ read, size = 'sm' }: { read: Read; size?: 'xs' | 'sm' | 'md' }) {
  const v = read.entry.value
  return <Cover hiveId={v.hiveId} title={v.title} authors={v.authors} entry={read.entry} size={size} />
}

/** A backdrop of the period's covers, repeated so a short year still fills the page. */
function CoverWall({ reads }: { reads: Read[] }) {
  const unique = [...new Map(reads.map((r) => [r.entry.uri, r])).values()]
  if (unique.length < 3) return null
  const tiles = Array.from({ length: Math.max(30, unique.length) }, (_, i) => unique[i % unique.length]!).slice(0, 40)
  return (
    <div className="slide-covers wall" aria-hidden="true">
      {tiles.map((r, i) => (
        <CoverOf key={i} read={r} size="xs" />
      ))}
    </div>
  )
}

/** True while the period is still running, so copy can say "so far". */
function isOngoing(period: Period): boolean {
  const [start, end] = periodRange(period)
  return Date.now() >= start && Date.now() < end
}

function monthsElapsed(period: Period): number {
  if (period.kind === 'month') return 1
  if (!isOngoing(period)) return 12
  return new Date().getUTCMonth() + 1
}

export function buildSlides(s: CoveredStats): Slide[] {
  const label = periodLabel(s.period)
  const soFar = isOngoing(s.period) ? ' so far' : ''
  const slides: Slide[] = []

  if (s.booksFinished === 0) {
    return [
      {
        key: 'empty',
        theme: 'theme-ink',
        body: (
          <div className="slide-content">
            <p className="eyebrow">Papertrail Covered · {label}</p>
            <p className="big">No finished books in {label}{soFar}.</p>
            <p className="say">
              {s.started
                ? `You started ${plural(s.started, 'book')} though. The story isn't over.`
                : 'Every reading year starts with a single page.'}
            </p>
          </div>
        ),
      },
    ]
  }

  slides.push({
    key: 'intro',
    theme: 'theme-ink',
    body: (
      <>
        <CoverWall reads={s.reads} />
        <div className="slide-content">
          <p className="eyebrow">Papertrail Covered</p>
          <p className="huge">{label}</p>
          <p className="big">Your reading{soFar}, covered.</p>
          <p className="say">Tap to turn the page.</p>
        </div>
      </>
    ),
  })

  const perMonth = s.booksFinished / monthsElapsed(s.period)
  slides.push({
    key: 'count',
    theme: 'theme-vermilion',
    body: (
      <div className="slide-content">
        <p className="eyebrow">Books finished</p>
        <p className="huge">{s.booksFinished}</p>
        <p className="say">
          {s.pagesRead > 0
            ? `That's ${s.pagesRead.toLocaleString('en-GB')} pages${s.pagesKnown < s.booksFinished ? ' that we can count' : ''}.`
            : 'Every one of them logged.'}
          {s.period.kind === 'year' && perMonth >= 0.5 ? ` About ${perMonth.toFixed(perMonth < 10 ? 1 : 0)} a month.` : ''}
        </p>
      </div>
    ),
  })

  if (s.byMonth) {
    const max = Math.max(...s.byMonth, 1)
    slides.push({
      key: 'months',
      theme: 'theme-paper',
      body: (
        <div className="slide-content">
          <p className="eyebrow">Month by month</p>
          <div className="bars" style={{ color: '#c8402a' }} role="img" aria-label="Books finished per month">
            {s.byMonth.map((count, month) => (
              <div key={month} className={s.busiestMonth?.month === month ? 'peak' : ''}>
                {count > 0 && <b>{count}</b>}
                <i style={{ height: `${(count / max) * 100}%`, background: s.busiestMonth?.month === month ? '#1d1b17' : undefined }} />
                <span>{MONTHS[month]!.charAt(0)}</span>
              </div>
            ))}
          </div>
          {s.busiestMonth && (
            <p className="say">
              {MONTHS[s.busiestMonth.month]} was your biggest month, with {plural(s.busiestMonth.count, 'book')}.
              {s.monthStreak >= 2 ? ` You finished a book ${s.monthStreak} months running.` : ''}
            </p>
          )}
        </div>
      ),
    })
  } else {
    slides.push({
      key: 'list',
      theme: 'theme-paper',
      body: (
        <div className="slide-content">
          <p className="eyebrow">Everything you finished</p>
          <div className="slide-covers">
            {s.reads.slice(0, 24).map((r, i) => (
              <CoverOf key={`${r.entry.uri}-${i}`} read={r} />
            ))}
          </div>
        </div>
      ),
    })
  }

  if (s.topGenres.length) {
    slides.push({
      key: 'genres',
      theme: 'theme-green',
      body: (
        <div className="slide-content">
          <p className="eyebrow">Your shelves leaned towards</p>
          <ol className="slide-list">
            {s.topGenres.map((g) => (
              <li key={g.genre}>
                {g.genre}
                <span>{plural(g.count, 'book')}</span>
              </li>
            ))}
          </ol>
        </div>
      ),
    })
  }

  if (s.longest) {
    slides.push({
      key: 'lengths',
      theme: 'theme-ochre',
      body: (
        <div className="slide-content">
          <p className="eyebrow">The long and the short of it</p>
          <div className="slide-row">
            <CoverOf read={s.longest.read} />
            <div>
              <p className="say">Longest</p>
              <p className="big" style={{ fontSize: '1.6rem' }}>{s.longest.read.entry.value.title}</p>
              <p className="say">{s.longest.pages.toLocaleString('en-GB')} pages</p>
            </div>
          </div>
          {s.shortest && (
            <div className="slide-row">
              <CoverOf read={s.shortest.read} />
              <div>
                <p className="say">Shortest</p>
                <p className="big" style={{ fontSize: '1.6rem' }}>{s.shortest.read.entry.value.title}</p>
                <p className="say">{s.shortest.pages.toLocaleString('en-GB')} pages</p>
              </div>
            </div>
          )}
        </div>
      ),
    })
  }

  if (s.fastest) {
    slides.push({
      key: 'pace',
      theme: 'theme-plum',
      body: (
        <div className="slide-content">
          <p className="eyebrow">Your fastest read</p>
          <p className="huge">{s.fastest.days}</p>
          <p className="big">{s.fastest.days === 1 ? 'day' : 'days'} for {s.fastest.read.entry.value.title}.</p>
          {s.averageDays !== null && (
            <p className="say">
              On average a book took you {Math.round(s.averageDays)} {Math.round(s.averageDays) === 1 ? 'day' : 'days'}
              {s.slowest ? `; ${s.slowest.read.entry.value.title} kept you company longest, at ${s.slowest.days}.` : '.'}
            </p>
          )}
        </div>
      ),
    })
  }

  if (s.topRated.length) {
    slides.push({
      key: 'rated',
      theme: 'theme-sky',
      body: (
        <div className="slide-content">
          <p className="eyebrow">Your highest rated</p>
          {s.topRated.map((r) => (
            <div className="slide-row" key={r.entry.uri}>
              <CoverOf read={r} />
              <div>
                <p className="big" style={{ fontSize: '1.4rem' }}>{r.entry.value.title}</p>
                <Stars stars={r.entry.value.stars} size={20} />
              </div>
            </div>
          ))}
          {s.averageRating !== null && <p className="say">You gave books an average of {s.averageRating.toFixed(1)} stars.</p>}
        </div>
      ),
    })
  }

  if (s.topAuthor) {
    slides.push({
      key: 'author',
      theme: 'theme-vermilion',
      body: (
        <div className="slide-content">
          <p className="eyebrow">Most-read author</p>
          <p className="big" style={{ fontSize: 'clamp(2.2rem, 12cqi, 3.6rem)' }}>{s.topAuthor.name}</p>
          <p className="say">{plural(s.topAuthor.count, 'book')}. Loyalty noted.</p>
        </div>
      ),
    })
  }

  const extras = [
    s.started ? `You started ${plural(s.started, 'book')}.` : null,
    s.reviewed ? `You reviewed ${plural(s.reviewed, 'book')}.` : null,
    s.rereads ? `You went back to ${plural(s.rereads, 'old favourite')}.` : null,
    s.abandoned ? `You set ${plural(s.abandoned, 'book')} aside — life's too short.` : null,
  ].filter(Boolean)
  if (extras.length) {
    slides.push({
      key: 'extras',
      theme: 'theme-ink',
      body: (
        <div className="slide-content">
          <p className="eyebrow">Also in {label}</p>
          {extras.map((line) => (
            <p key={line} className="big" style={{ fontSize: '1.7rem' }}>
              {line}
            </p>
          ))}
        </div>
      ),
    })
  }

  if (s.first && s.last) {
    slides.push({
      key: 'bookends',
      theme: 'theme-paper',
      body: (
        <div className="slide-content">
          <p className="eyebrow">Bookends</p>
          <div className="slide-row">
            <CoverOf read={s.first} />
            <div>
              <p className="say">First finished · {formatDate(s.first.finishedAt)}</p>
              <p className="big" style={{ fontSize: '1.5rem' }}>{s.first.entry.value.title}</p>
            </div>
          </div>
          <div className="slide-row">
            <CoverOf read={s.last} />
            <div>
              <p className="say">Latest · {formatDate(s.last.finishedAt)}</p>
              <p className="big" style={{ fontSize: '1.5rem' }}>{s.last.entry.value.title}</p>
            </div>
          </div>
        </div>
      ),
    })
  }

  slides.push({
    key: 'outro',
    theme: 'theme-vermilion',
    body: (
      <>
        <CoverWall reads={s.reads} />
        <div className="slide-content">
          <p className="eyebrow">Papertrail Covered</p>
          <p className="big">That's your {label}{soFar}, covered.</p>
          <p className="say">
            {plural(s.booksFinished, 'book')}. {isOngoing(s.period) ? 'Plenty of pages left to turn.' : 'On to the next chapter.'}
          </p>
        </div>
      </>
    ),
  })

  return slides
}

/** Catalogue facts (page counts, genres) for every book read in the period. */
function useFacts(books: BookEntry[], period: Period) {
  const hiveIds = useMemo(() => [...new Set(readsIn(books, period).map((r) => r.entry.value.hiveId))], [books, period])
  const results = useQueries({
    queries: hiveIds.map((hiveId) => ({
      queryKey: ['catalog', hiveId],
      queryFn: () => fetchCatalogBook(hiveId),
      staleTime: 6 * 60 * 60 * 1000,
    })),
  })
  const ready = results.every((r) => !r.isPending)
  const byId = new Map<string, CatalogBook | null | undefined>(hiveIds.map((id, i) => [id, results[i]?.data]))
  return { ready, byId }
}

export function CoveredStory({ books, period, onClose }: { books: BookEntry[]; period: Period; onClose: () => void }) {
  const { ready, byId } = useFacts(books, period)
  // Don't hold the story hostage to a slow catalogue: start after 6 s regardless.
  const [timedOut, setTimedOut] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 6000)
    return () => clearTimeout(t)
  }, [])

  const stats = useMemo(
    () =>
      computeCovered(books, period, (entry) => {
        const c = byId.get(entry.value.hiveId)
        return c ? { pages: c.numPages, genres: c.genres } : undefined
      }),
    // byId is rebuilt every render; recompute only when readiness changes.
    [books, period, ready, timedOut],
  )
  const slides = useMemo(() => buildSlides(stats), [stats])
  const [index, setIndex] = useState(0)
  const frame = useRef<HTMLDivElement>(null)
  const touchX = useRef<number | null>(null)
  const started = ready || timedOut

  const next = useCallback(() => setIndex((i) => Math.min(i + 1, slides.length - 1)), [slides.length])
  const prev = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault()
        next()
      } else if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    frame.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [next, prev, onClose])

  const slide = slides[index]!
  const last = index === slides.length - 1

  return (
    <div className="story" role="dialog" aria-modal="true" aria-label={`Covered: ${periodLabel(period)}`}>
      <div
        className={`story-frame ${started ? slide.theme : 'theme-ink'}`}
        ref={frame}
        tabIndex={-1}
        onTouchStart={(e) => (touchX.current = e.touches[0]?.clientX ?? null)}
        onTouchEnd={(e) => {
          const start = touchX.current
          const end = e.changedTouches[0]?.clientX
          if (start === null || end === undefined) return
          if (end - start > 40) prev()
          else if (start - end > 40) next()
          touchX.current = null
        }}
      >
        <div className="story-bars" aria-hidden="true">
          {slides.map((s, i) => (
            <span key={s.key} className={i < index ? 'done' : i === index ? 'current' : ''}>
              <i />
            </span>
          ))}
        </div>
        <button className="icon-btn story-close" onClick={onClose} style={{ color: 'inherit' }}>
          <Icon name="close" label="Close Covered" />
        </button>
        {started ? (
          <>
            <div className="slide" key={slide.key} aria-live="polite">
              {slide.body}
            </div>
            <button className="story-tap prev" onClick={prev} aria-label="Previous" disabled={index === 0} />
            {!last && <button className="story-tap next" onClick={next} aria-label="Next" />}
            {last && (
              <div style={{ position: 'absolute', bottom: 40, left: 28, right: 28, zIndex: 3 }} className="row">
                <button className="btn" style={{ borderColor: 'currentColor' }} onClick={() => setIndex(0)}>
                  <Icon name="refresh" size={16} /> Replay
                </button>
                <button className="btn" style={{ borderColor: 'currentColor' }} onClick={onClose}>
                  Done
                </button>
              </div>
            )}
            {index === 0 && <p className="story-hint">Tap, swipe or use the arrow keys</p>}
          </>
        ) : (
          <div className="slide">
            <div className="slide-content">
              <p className="eyebrow">Papertrail Covered</p>
              <p className="big">Pulling your {periodLabel(period)} together…</p>
              <span className="spinner" aria-hidden="true" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

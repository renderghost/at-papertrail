import { useId, type ReactNode } from 'react'
import type { Profile } from '../lib/atproto'
import { progressPercent } from '../lib/bookhive/lifecycle'
import { STATUS, STATUS_LABEL, isBookStatus, type BookProgress } from '../lib/bookhive/types'

/** Read-only stars from a 1–10 BookHive rating. */
export function Stars({ stars, size = 16 }: { stars: number | undefined; size?: number }) {
  if (!stars) return null
  const rating = stars / 2
  return (
    <span className="stars" role="img" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = Math.max(0, Math.min(1, rating - (i - 1)))
        return <StarGlyph key={i} fill={fill} size={size} />
      })}
    </span>
  )
}

function StarGlyph({ fill, size }: { fill: number; size: number }) {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id={id}>
          <stop offset={`${fill * 100}%`} stopColor="currentColor" />
          <stop offset={`${fill * 100}%`} stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"
        fill={`url(#${id})`}
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Half-star rating input; value is BookHive's 0–10 (0 = none). */
export function StarInput({ value, onChange }: { value: number; onChange: (stars: number) => void }) {
  return (
    <div className="row">
      <div className="star-input" role="radiogroup" aria-label="Your rating">
        {[1, 2, 3, 4, 5].map((i) => {
          const full = i * 2
          const half = full - 1
          return (
            <span key={i} style={{ position: 'relative', display: 'inline-flex' }}>
              <button
                type="button"
                className="half"
                role="radio"
                aria-checked={value === half}
                aria-label={`${i - 0.5} stars`}
                onClick={() => onChange(value === half ? 0 : half)}
              />
              <button
                type="button"
                className={value >= half ? 'on' : ''}
                role="radio"
                aria-checked={value === full}
                aria-label={`${i} star${i > 1 ? 's' : ''}`}
                onClick={() => onChange(value === full ? 0 : full)}
              >
                <StarGlyph fill={value >= full ? 1 : value === half ? 0.5 : 0} size={30} />
              </button>
            </span>
          )
        })}
      </div>
      {value > 0 && (
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => onChange(0)}>
          Clear
        </button>
      )}
    </div>
  )
}

const PILL_CLASS: Record<string, string> = {
  [STATUS.reading]: 'pill-reading',
  [STATUS.finished]: 'pill-finished',
  [STATUS.wantToRead]: 'pill-want',
  [STATUS.abandoned]: 'pill-abandoned',
}

export function StatusPill({ status }: { status: string | undefined }) {
  if (!isBookStatus(status)) return null
  return <span className={`pill ${PILL_CLASS[status]}`}>{STATUS_LABEL[status]}</span>
}

export function Progress({
  progress,
  done = false,
  compact = false,
}: {
  progress: BookProgress | undefined
  done?: boolean
  /** Percent only, for narrow spaces. */
  compact?: boolean
}) {
  const percent = done ? 100 : progressPercent(progress)
  if (percent === null) return null
  const label =
    !done && !compact && progress?.currentPage && progress.totalPages
      ? `p. ${progress.currentPage} of ${progress.totalPages}`
      : `${percent}%`
  return (
    <div className={`progress${percent >= 100 ? ' progress-done' : ''}`}>
      <div
        className="progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="Reading progress"
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <span>{label}</span>
    </div>
  )
}

export function Avatar({ profile, size = 40 }: { profile: Pick<Profile, 'handle' | 'avatar' | 'displayName'>; size?: number }) {
  if (profile.avatar) {
    return <img className="avatar" src={profile.avatar} alt="" width={size} height={size} loading="lazy" />
  }
  const initial = (profile.displayName || profile.handle).replace(/^@/, '').charAt(0)
  return (
    <span className="avatar avatar-fallback" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden="true">
      {initial}
    </span>
  )
}

export function Loading({ children = 'Loading…' }: { children?: ReactNode }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{children}</span>
    </div>
  )
}

export function ErrorNote({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    <div className="notice notice-error" role="alert">
      {message}
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  )
}

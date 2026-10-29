import { useState } from 'react'
import { truncate } from '../lib/format'

/**
 * A review's text: long ones fold, and spoiler-flagged ones (PopFeed's
 * `containsSpoilers`) stay hidden until the reader asks for them.
 */
export function ReviewText({ text, spoilers = false, max = 360 }: { text: string | undefined; spoilers?: boolean; max?: number }) {
  const [revealed, setRevealed] = useState(!spoilers)
  const [open, setOpen] = useState(false)
  const clean = text?.trim()
  if (!clean) return null
  if (!revealed) {
    return (
      <p className="review review-hidden">
        <span className="muted">Contains spoilers.</span>{' '}
        <button className="link-btn" onClick={() => setRevealed(true)}>
          Show review
        </button>
      </p>
    )
  }
  const long = clean.length > max
  return (
    <p className="review">
      {long && !open ? truncate(clean, max) : clean}
      {long && (
        <>
          {' '}
          <button className="link-btn" onClick={() => setOpen((o) => !o)}>
            {open ? 'Show less' : 'Read more'}
          </button>
        </>
      )}
    </p>
  )
}

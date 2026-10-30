import { useEffect, useId, useRef, type ReactNode } from 'react'

/**
 * A native modal dialog (#106), open from the moment it mounts: the page
 * behind is inert, Escape closes it, and focus goes back to whatever opened
 * it. `closedBy="any"` also closes it on a click outside, for dialogs with
 * nothing to lose; a form keeps the default, so a stray click can't throw
 * away what you typed. `children` gets `close` for actions that finish
 * before closing.
 */
export function Dialog({
  title,
  sub,
  closedBy = 'closerequest',
  onClose,
  children,
}: {
  title: ReactNode
  sub?: ReactNode
  closedBy?: 'any' | 'closerequest'
  onClose: () => void
  children: (close: () => void) => ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const el = ref.current
    if (!el || el.open) return
    el.setAttribute('closedby', closedBy)
    el.showModal()
  }, [closedBy])
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId} onClose={onClose}>
      <h2 id={titleId} className="dialog-title">
        {title}
      </h2>
      {sub && <p className="muted small dialog-sub">{sub}</p>}
      {children(() => ref.current?.close())}
    </dialog>
  )
}

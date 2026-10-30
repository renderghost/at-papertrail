import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { describeError } from '../lib/errors'
import { Icon } from './Icon'

type ToastOptions = {
  /** Puts the change back; the toast then says it's undone. */
  undo?: () => Promise<unknown> | void
  /** Any other single action, such as signing in again. */
  action?: { label: string; run: () => void }
  tone?: 'error'
}

type Toast = ToastOptions & { id: number; text: string }

type Notify = (text: string, options?: ToastOptions) => void

const ToastContext = createContext<Notify>(() => {})

/** Says what a change did, with Undo where it can be undone (#106). */
export function useToast(): Notify {
  return useContext(ToastContext)
}

let lastId = 0

/**
 * One note at a time at the foot of the window: a manual popover, so clicks
 * elsewhere don't close it, with its own close button. It times out, but
 * not while the pointer is on it or focus is in it. A separate live region,
 * always in the page, reads each note out.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null)
  const [busy, setBusy] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const held = useRef(false)

  const notify = useCallback<Notify>((text, options = {}) => setToast({ ...options, id: ++lastId, text }), [])

  useEffect(() => {
    const el = panel.current
    if (!el) return
    if (toast && !el.matches(':popover-open')) el.showPopover()
    if (!toast && el.matches(':popover-open')) el.hidePopover()
    if (!toast) return
    // Long enough to reach Undo; held open while you're on it.
    let timer = 0
    const expire = () => {
      if (held.current) timer = window.setTimeout(expire, 1000)
      else setToast((t) => (t?.id === toast.id ? null : t))
    }
    timer = window.setTimeout(expire, toast.undo || toast.action ? 8000 : 5000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const undo = async () => {
    if (!toast?.undo) return
    setBusy(true)
    try {
      await toast.undo()
      notify('Undone.')
    } catch (err) {
      notify(`Couldn't undo: ${describeError(err).message}`, { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const error = toast?.tone === 'error'
  return (
    <ToastContext.Provider value={notify}>
      {children}
      <p className="visually-hidden" role="status">
        {toast && !error ? toast.text : ''}
      </p>
      <p className="visually-hidden" role="alert">
        {error ? toast.text : ''}
      </p>
      <div
        ref={panel}
        popover="manual"
        className={`toast${error ? ' toast-error' : ''}`}
        onPointerEnter={() => (held.current = true)}
        onPointerLeave={() => (held.current = false)}
        onFocus={() => (held.current = true)}
        onBlur={() => (held.current = false)}
      >
        <span className="toast-text">{toast?.text}</span>
        {toast?.undo && (
          <button type="button" className="toast-action" disabled={busy} onClick={() => void undo()}>
            Undo
          </button>
        )}
        {toast?.action && (
          <button
            type="button"
            className="toast-action"
            onClick={() => {
              toast.action!.run()
              setToast(null)
            }}
          >
            {toast.action.label}
          </button>
        )}
        <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => setToast(null)}>
          <Icon name="close" size={16} />
        </button>
      </div>
    </ToastContext.Provider>
  )
}

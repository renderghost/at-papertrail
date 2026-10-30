import { useEffect, type RefObject } from 'react'

/**
 * Places a popover by its button where CSS anchor positioning isn't
 * supported: under the button, or over it near the bottom of the window,
 * on whichever side has room. Placed this way it's fixed, so it would drift
 * from a button that scrolls with the page; `closeOnScroll` closes it
 * instead. `key` re-attaches when the popover first renders.
 */
export function usePopoverPlacement(
  trigger: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  { closeOnScroll = false, key }: { closeOnScroll?: boolean; key?: unknown } = {},
) {
  useEffect(() => {
    const el = panel.current
    if (!el) return
    const place = (e: Event) => {
      if ((e as ToggleEvent).newState !== 'open' || CSS.supports('position-area: block-end') || !trigger.current) return
      const r = trigger.current.getBoundingClientRect()
      const below = r.bottom < window.innerHeight * 0.6
      el.style.top = below ? `${r.bottom + 4}px` : 'auto'
      el.style.bottom = below ? 'auto' : `${window.innerHeight - r.top + 4}px`
      const alignLeft = r.right < 220
      el.style.left = alignLeft ? `${Math.max(8, r.left)}px` : 'auto'
      el.style.right = alignLeft ? 'auto' : `${Math.max(8, window.innerWidth - r.right)}px`
    }
    const close = () => el.hidePopover()
    const watch = (e: Event) => {
      if ((e as ToggleEvent).newState === 'open') window.addEventListener('scroll', close, { passive: true, once: true })
      else window.removeEventListener('scroll', close)
    }
    el.addEventListener('beforetoggle', place)
    if (closeOnScroll) el.addEventListener('toggle', watch)
    return () => {
      el.removeEventListener('beforetoggle', place)
      el.removeEventListener('toggle', watch)
      window.removeEventListener('scroll', close)
    }
  }, [trigger, panel, closeOnScroll, key])
}

import { useId, useRef, useState } from 'react'
import { useMaybeSession } from '../lib/auth'
import { withStatus } from '../lib/batch'
import { applyPatch } from '../lib/bookhive/library'
import { NOT_INTERESTED, STATUS, STATUS_LABEL, isBookStatus, type BookIdentifiers, type BookStatus, type CatalogBook } from '../lib/bookhive/types'
import { describeError } from '../lib/errors'
import { useBookWrites, useMyCopy } from '../lib/hooks'
import { newBookRecord } from '../lib/search'
import { useNotInterested } from '../lib/useLists'
import { useCanWrite } from '../lib/usePeople'
import { Icon, type IconName } from './Icon'
import { AddToListDialog } from './Lists'
import { usePopoverPlacement } from './popover'
import { useToast } from './Toast'

export type StatusBook = { hiveId: string; title: string; authors: string; identifiers?: BookIdentifiers; catalog: CatalogBook | null }

const SEGMENTS: { status: BookStatus; icon: IconName }[] = [
  { status: STATUS.wantToRead, icon: 'bookmark' },
  { status: STATUS.reading, icon: 'book' },
  { status: STATUS.finished, icon: 'check' },
]

/** A book's state: its status if it's yours, Not Interested if you passed on it, else none. */
type State = BookStatus | 'notInterested' | null

/**
 * Your status for a book (#106): Want to Read | Reading | Read | ⋯, in
 * BookHive's words. Every segment is neutral until chosen; the chosen one
 * fills and gains a tick. ⋯ holds Abandoned and Not Interested, then owning
 * a copy, lists and removing it. Each change saves at once and says what it
 * did, with Undo. Compact cards show the segments as icons. Nothing at all
 * when signed out.
 */
export function StatusControl(props: { book: StatusBook; variant?: 'full' | 'icons'; owned?: boolean }) {
  const me = useMaybeSession()
  return me ? <Control {...props} did={me.did} /> : null
}

function Control({ book, variant = 'full', owned: ownNew = false, did }: { book: StatusBook; variant?: 'full' | 'icons'; owned?: boolean; did: string }) {
  const mine = useMyCopy(book)
  const passed = useNotInterested()
  const writes = useBookWrites()
  const notify = useToast()
  const lists = useCanWrite('lists')
  const [pending, setPending] = useState<{ state: State } | null>(null)
  const [listsOpen, setListsOpen] = useState(false)
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  // A card scrolls with the page: a fixed menu would drift from it, so scrolling closes it.
  usePopoverPlacement(trigger, panel, { closeOnScroll: true })

  const listBook = { hiveId: book.hiveId, title: book.title, authors: book.authors, identifiers: book.identifiers }
  const saved: State = mine ? (isBookStatus(mine.value.status) ? mine.value.status : null) : passed.has(book) ? 'notInterested' : null
  // Shown at once while it saves; the saved state takes over when it's done, or comes back if it fails.
  const state = pending ? pending.state : saved

  const run = async (next: State, change: () => Promise<{ text: string; undo?: () => Promise<unknown> }>) => {
    if (pending) return
    setPending({ state: next })
    try {
      const { text, undo } = await change()
      notify(text, { undo })
    } catch (err) {
      notify(`Couldn't save that: ${describeError(err).message}`, { tone: 'error' })
    } finally {
      setPending(null)
    }
  }

  const choose = (status: BookStatus) => {
    if (state === status) return
    void run(status, async () => {
      const label = STATUS_LABEL[status]
      if (mine) {
        const before = mine
        const after = await writes.update.mutateAsync({ entry: mine, next: withStatus(mine.value, status) })
        return { text: `Moved to ${label}`, undo: () => writes.update.mutateAsync({ entry: after, next: before.value }) }
      }
      const record = newBookRecord(book, book.catalog, status)
      const created = await writes.create.mutateAsync(ownNew ? { ...record, owned: true } : record)
      // Choosing a status means you're interested after all.
      const wasPassed = saved === 'notInterested'
      if (wasPassed) await passed.unmark(listBook)
      return {
        text: `Added to ${label}`,
        undo: async () => {
          await writes.remove.mutateAsync(created)
          if (wasPassed) await passed.mark(listBook)
        },
      }
    })
  }

  const notInterested = () => {
    if (!lists.allowed) {
      notify('Papertrail needs your permission to save lists, where Not Interested is kept.', { action: { label: 'Sign in again', run: lists.reconsent } })
      return
    }
    if (state === 'notInterested') {
      void run(null, async () => {
        await passed.unmark(listBook)
        return { text: `Taken off ${NOT_INTERESTED}`, undo: () => passed.mark(listBook) }
      })
      return
    }
    void run('notInterested', async () => {
      const removed = mine
      await passed.mark(listBook)
      if (removed) await writes.remove.mutateAsync(removed)
      return {
        text: removed ? `${NOT_INTERESTED}: taken off your shelves` : `Marked ${NOT_INTERESTED}`,
        undo: async () => {
          if (removed) await writes.restore.mutateAsync(removed)
          await passed.unmark(listBook)
        },
      }
    })
  }

  const toggleOwned = () =>
    void run(state, async () => {
      if (mine) {
        const before = mine
        const own = !mine.value.owned
        const after = await writes.update.mutateAsync({ entry: mine, next: applyPatch(mine.value, { owned: own ? true : null }) })
        return { text: own ? 'Marked as owned' : 'Marked as not owned', undo: () => writes.update.mutateAsync({ entry: after, next: before.value }) }
      }
      // Owning it without a reading status, as BookHive's Own button does.
      const created = await writes.create.mutateAsync({ ...newBookRecord(book, book.catalog, ''), owned: true })
      return { text: 'Added to your library as owned', undo: () => writes.remove.mutateAsync(created) }
    })

  const removeFromLibrary = () =>
    void run(null, async () => {
      const removed = mine!
      await writes.remove.mutateAsync(removed)
      return { text: 'Removed from your library', undo: () => writes.restore.mutateAsync(removed) }
    })

  // Close the menu, then act, with focus back on ⋯.
  const fromMenu = (act: () => void) => () => {
    trigger.current?.focus()
    panel.current?.hidePopover()
    act()
  }

  const extra = state === STATUS.abandoned ? STATUS_LABEL[STATUS.abandoned] : state === 'notInterested' ? NOT_INTERESTED : null
  const icons = variant === 'icons'
  return (
    <div className={`status-control status-${variant}`} role="group" aria-label={`Your status for ${book.title}`} aria-busy={pending ? true : undefined}>
      {SEGMENTS.map(({ status, icon }) => {
        const on = state === status
        return (
          <button
            key={status}
            type="button"
            aria-pressed={on}
            aria-label={`${STATUS_LABEL[status]}: ${book.title}`}
            title={icons ? STATUS_LABEL[status] : undefined}
            onClick={() => choose(status)}
          >
            {icons ? (
              <Icon name={icon} size={18} />
            ) : (
              <>
                {on && <Icon name="check" size={14} />}
                <span>{STATUS_LABEL[status]}</span>
              </>
            )}
          </button>
        )
      })}
      <button
        ref={trigger}
        type="button"
        className={`status-more${extra ? ' is-chosen' : ''}`}
        popoverTarget={`${id}-menu`}
        aria-label={`${extra ? `${extra}. ` : ''}More for ${book.title}`}
        title={extra ?? 'More'}
      >
        {extra ? (
          icons ? (
            <Icon name={state === STATUS.abandoned ? 'stop' : 'hide'} size={18} />
          ) : (
            <>
              <Icon name="check" size={14} />
              <span>{extra}</span>
            </>
          )
        ) : (
          <Icon name="more" size={18} />
        )}
      </button>
      <div ref={panel} id={`${id}-menu`} popover="auto" className="more-menu status-menu">
        <button type="button" aria-pressed={state === STATUS.abandoned} onClick={fromMenu(() => choose(STATUS.abandoned))}>
          {STATUS_LABEL[STATUS.abandoned]}
        </button>
        <button type="button" aria-pressed={state === 'notInterested'} onClick={fromMenu(notInterested)}>
          {NOT_INTERESTED}
        </button>
        <hr />
        <button type="button" aria-pressed={!!mine?.value.owned} onClick={fromMenu(toggleOwned)}>
          I own a copy
        </button>
        <button type="button" onClick={fromMenu(() => setListsOpen(true))}>
          Add to a list…
        </button>
        {mine && (
          <button type="button" onClick={fromMenu(removeFromLibrary)}>
            Remove from library
          </button>
        )}
      </div>
      {listsOpen && <AddToListDialog did={did} book={listBook} onClose={() => setListsOpen(false)} />}
    </div>
  )
}

import { Children, useEffect, useId, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { displayAuthors } from '../lib/bookhive/authors'
import type { BookEntry, BookIdentifiers, CatalogBook } from '../lib/bookhive/types'
import { bookPath } from '../lib/paths'
import { Avatar } from './bits'
import { Cover } from './Cover'
import { Icon } from './Icon'
import { QuickAdd } from './QuickAdd'

/**
 * The book and person components (#100). One visual language everywhere:
 * - large cards (the Currently Reading shape), 3 wide;
 * - compact cards (vertical), 5 wide;
 * - list cards, stacked full width;
 * - embedded cards, a book inset in a feed entry.
 * The whole card opens its book or person: the title is the one real link,
 * stretched over the card, and any other link or button stays its own.
 */

export type CardBook = {
  hiveId: string
  title: string
  authors: string
  identifiers?: BookIdentifiers
  catalog?: CatalogBook | null
  /** A copy of the book (yours or someone's), for its cover. */
  entry?: BookEntry
  coverUrl?: string
}

export type MoreItem = { label: string; onSelect?: () => void; href?: string }

export type BookCardSize = 'large' | 'compact' | 'embed'

/**
 * A book. `action` is the one primary action; by default "Want to read", or
 * your status if it's yours (nothing when signed out). Pass null for none.
 * The rest go under ⋯ More.
 */
export function BookCard({
  book,
  size = 'large',
  context,
  action,
  more = [],
  children,
  state,
}: {
  book: CardBook
  size?: BookCardSize
  context?: ReactNode
  action?: ReactNode
  more?: MoreItem[]
  /** Nested content, such as the people who read it (list cards). */
  children?: ReactNode
  /** Router state for the book page (a copy it can show at once). */
  state?: unknown
}) {
  const primary =
    action === undefined ? (
      <QuickAdd book={{ hiveId: book.hiveId, title: book.title, authors: book.authors, identifiers: book.identifiers, catalog: book.catalog ?? null }} />
    ) : (
      action
    )
  return (
    <article className={`card book-card book-card-${size}`}>
      <Cover
        hiveId={book.hiveId}
        title={book.title}
        authors={book.authors}
        entry={book.entry}
        isbn13={book.identifiers?.isbn13}
        fallbackUrl={book.coverUrl ?? book.catalog?.cover ?? book.catalog?.thumbnail}
        size={size === 'compact' ? 'fill' : 'sm'}
      />
      <div className="card-body">
        <h3 className="card-title">
          <Link className="card-link" to={bookPath(book.hiveId)} state={state} title={book.title}>
            {book.title}
          </Link>
        </h3>
        <p className="card-sub">{displayAuthors(book.authors)}</p>
        {context && <div className="card-context">{context}</div>}
        {children && <div className="card-children">{children}</div>}
        <CardActions label={book.title} primary={primary} more={more} />
      </div>
    </article>
  )
}

export type CardPerson = { name: string; handle?: string; avatar?: string }

/** A person (a reader or an author), shaped like the book cards: a round avatar where the cover goes. */
export function PersonCard({
  person,
  to,
  size = 'large',
  context,
  action,
  more = [],
  children,
}: {
  person: CardPerson
  to: string
  size?: 'large' | 'compact'
  context?: ReactNode
  action?: ReactNode
  more?: MoreItem[]
  children?: ReactNode
}) {
  return (
    <article className={`card person-card person-card-${size}`}>
      <Avatar profile={{ handle: person.handle ?? person.name, displayName: person.name, avatar: person.avatar }} size={size === 'compact' ? 64 : 48} />
      <div className="card-body">
        <h3 className="card-title">
          <Link className="card-link" to={to} title={person.name}>
            {person.name}
          </Link>
        </h3>
        {person.handle && <p className="card-sub">@{person.handle}</p>}
        {context && <div className="card-context">{context}</div>}
        {children && <div className="card-children">{children}</div>}
        <CardActions label={person.name} primary={action} more={more} />
      </div>
    </article>
  )
}

function CardActions({ label, primary, more }: { label: string; primary: ReactNode; more: MoreItem[] }) {
  if (!primary && !more.length) return null
  return (
    <footer className="card-actions">
      {primary}
      <MoreMenu label={label} items={more} />
    </footer>
  )
}

/** Cards in a grid: large (3 wide), compact (5 wide) or a list (stacked). Never more than 5 columns. */
export function CardGrid({ size, label, className, children }: { size: 'large' | 'compact' | 'list'; label?: string; className?: string; children: ReactNode }) {
  return (
    <ul className={`card-grid card-grid-${size}${className ? ` ${className}` : ''}`} aria-label={label}>
      {Children.map(children, (child) => (child ? <li>{child}</li> : null))}
    </ul>
  )
}

/**
 * ⋯ More: a few more actions in a popover, as plain buttons and links (Tab
 * moves through them; Escape or a click elsewhere closes it, and focus goes
 * back to the button). Not an ARIA menu, which would promise arrow keys.
 */
export function MoreMenu({ label, items }: { label: string; items: MoreItem[] }) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = panel.current
    if (!el) return
    // Without CSS anchor positioning, place it from the button: under it, or over it near the bottom.
    const place = (e: Event) => {
      if ((e as ToggleEvent).newState !== 'open' || CSS.supports('position-area: block-end')) return
      const r = trigger.current!.getBoundingClientRect()
      const below = r.bottom < window.innerHeight * 0.6
      el.style.top = below ? `${r.bottom + 4}px` : 'auto'
      el.style.bottom = below ? 'auto' : `${window.innerHeight - r.top + 4}px`
      const alignLeft = r.right < 220
      el.style.left = alignLeft ? `${Math.max(8, r.left)}px` : 'auto'
      el.style.right = alignLeft ? 'auto' : `${Math.max(8, window.innerWidth - r.right)}px`
    }
    // A fixed popover would drift from its button as the page scrolls: close it instead.
    const close = () => el.hidePopover()
    const watch = (e: Event) => {
      if ((e as ToggleEvent).newState === 'open') window.addEventListener('scroll', close, { passive: true, once: true })
      else window.removeEventListener('scroll', close)
    }
    el.addEventListener('beforetoggle', place)
    el.addEventListener('toggle', watch)
    return () => {
      el.removeEventListener('beforetoggle', place)
      el.removeEventListener('toggle', watch)
      window.removeEventListener('scroll', close)
    }
  }, [items.length])

  if (!items.length) return null
  return (
    <>
      <button ref={trigger} type="button" className="icon-btn more-btn" popoverTarget={id} aria-label={`More: ${label}`} title="More">
        <Icon name="more" />
      </button>
      <div ref={panel} id={id} popover="auto" className="more-menu">
        {items.map((item) =>
          item.href ? (
            <a key={item.label} href={item.href} target="_blank" rel="noreferrer" onClick={() => panel.current?.hidePopover()}>
              {item.label}
            </a>
          ) : (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                trigger.current?.focus()
                panel.current?.hidePopover()
                item.onSelect?.()
              }}
            >
              {item.label}
            </button>
          ),
        )}
      </div>
    </>
  )
}

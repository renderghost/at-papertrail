import type { BookIdentifiers } from '../lib/bookhive/types'
import { bylineLinks, bylineStatusLabel, findBylineBook, plainText, type BylineEdition } from '../lib/byline'
import { formatDate } from '../lib/format'
import { useByline } from '../lib/usePeople'
import { Icon } from './Icon'

const FORMAT: Record<string, string> = { hardcover: 'Hardback', paperback: 'Paperback', ebook: 'Ebook', audiobook: 'Audiobook' }

function editionLine(e: BylineEdition): string {
  const parts = [FORMAT[e.format] ?? e.format]
  if (e.pageCount) parts.push(`${e.pageCount} pages`)
  if (e.durationMinutes) parts.push(`${Math.floor(e.durationMinutes / 60)}h ${e.durationMinutes % 60}m`)
  if (e.publisher) parts.push(e.publisher)
  if (e.releaseDate) parts.push(formatDate(e.releaseDate))
  if (e.isbn13 ?? e.isbn10) parts.push(`ISBN ${e.isbn13 ?? e.isbn10}`)
  return parts.join(' · ')
}

/** The author's own record of this book on Byline: their blurb, editions and links. */
export function BylinePanel({ hiveId, identifiers }: { hiveId: string; identifiers: BookIdentifiers }) {
  const byline = useByline()
  const match = byline.data ? findBylineBook(byline.data, { hiveId, identifiers }) : null
  if (!match) return null
  const v = match.book.value
  const status = bylineStatusLabel(v.status)
  const links = bylineLinks([...(v.links ?? []), ...(v.editions ?? []).flatMap((e) => e.links ?? [])])
  const text = plainText(v.description ?? v.shortDescription)
  return (
    <section className="section">
      <div className="section-title">
        <h2>From the author</h2>
        <span className="badge badge-hive">
          <Icon name="check" size={14} /> Verified by the author on Byline
        </span>
      </div>
      <div className="panel byline-panel">
        {v.tagline && <p className="byline-tagline">{v.tagline}</p>}
        {status && (
          <p className="small">
            <strong>{status}</strong>
            {v.publicationDate ? ` · ${formatDate(v.publicationDate)}` : ''}
          </p>
        )}
        {text && <p className="description">{text}</p>}
        {v.series?.name && (
          <p className="small muted">
            {v.series.position ? `Book ${v.series.position} of ` : 'Part of '}
            {v.series.name}
          </p>
        )}
        {v.editions?.length ? (
          <ul className="editions">
            {v.editions.map((e, i) => (
              <li key={`${e.format}-${i}`} className="small">
                {editionLine(e)}
              </li>
            ))}
          </ul>
        ) : null}
        {links.length > 0 && (
          <div className="row" style={{ marginTop: 12 }}>
            {links.slice(0, 6).map((l) => (
              <a
                key={l.url}
                className={`btn btn-sm${l.primary ? ' btn-primary' : ''}`}
                href={l.url}
                target="_blank"
                rel={l.isAffiliate ? 'noreferrer sponsored' : 'noreferrer'}
              >
                {l.label ?? l.retailer ?? new URL(l.url).host.replace(/^www\./, '')}
                {l.isAffiliate ? ' (affiliate)' : ''} <Icon name="external" size={12} />
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { blobUrl } from '../lib/atproto'
import { displayAuthors } from '../lib/bookhive/authors'
import { catalogCoverUrls, catalogPds } from '../lib/bookhive/catalog'
import { blobCid, type BookEntry } from '../lib/bookhive/types'
import { useCatalog, useInView } from '../lib/hooks'

const PLACEHOLDER_COLOURS = ['#c8402a', '#24543e', '#2b2823', '#4b2a4f', '#a8711c', '#2d4a6b', '#7a3b2e', '#55633a']

function colourFor(text: string): string {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PLACEHOLDER_COLOURS[h % PLACEHOLDER_COLOURS.length]!
}

type CoverProps = {
  hiveId: string
  title: string
  authors: string
  /** The record whose own cover (if any) should be shown first. */
  entry?: BookEntry
  isbn13?: string
  /** An extra candidate, e.g. a search result's cover. */
  fallbackUrl?: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
}

/**
 * A book cover, best source first: the reader's own cover blob, BookHive's
 * catalogue cover, the extra fallback, then Open Library by ISBN. Falls back to
 * a typeset cover so a missing image never leaves a hole.
 */
export function Cover({ hiveId, title, authors, entry, isbn13, fallbackUrl, size = 'md' }: CoverProps) {
  const { ref, inView } = useInView<HTMLDivElement>()
  const ownCid = blobCid(entry?.value.cover)
  const catalog = useCatalog(hiveId, inView && !ownCid)
  const pds = useQuery({ queryKey: ['catalog-pds'], queryFn: catalogPds, staleTime: Infinity, enabled: inView })

  const urls = useMemo(() => {
    const list: string[] = []
    if (entry && ownCid) list.push(blobUrl(entry.pds, entry.did, ownCid))
    if (catalog.data && pds.data) list.push(...catalogCoverUrls(catalog.data, pds.data))
    if (fallbackUrl) list.push(fallbackUrl)
    const isbn = isbn13 ?? entry?.value.identifiers?.isbn13 ?? catalog.data?.identifiers?.isbn13
    if (isbn) list.push(`https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`)
    return list
  }, [entry, ownCid, catalog.data, pds.data, fallbackUrl, isbn13])

  const [failed, setFailed] = useState<Set<string>>(() => new Set())
  const [loaded, setLoaded] = useState<string | null>(null)
  const src = urls.find((u) => !failed.has(u))
  const settled = ownCid || catalog.isFetched || !inView

  return (
    <div ref={ref} className={`cover cover-${size}`}>
      <div className="cover-placeholder" style={{ background: colourFor(title) }} aria-hidden="true">
        <span className="t">{title}</span>
        <span className="a">{displayAuthors(authors)}</span>
      </div>
      {inView && settled && src && (
        <img
          key={src}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          style={{ opacity: loaded === src ? 1 : 0, transition: 'opacity .25s ease', position: 'relative' }}
          onLoad={(e) => {
            // Open Library serves a 1×1 pixel for unknown ISBNs on some paths.
            if (e.currentTarget.naturalWidth < 10) setFailed((s) => new Set(s).add(src))
            else setLoaded(src)
          }}
          onError={() => setFailed((s) => new Set(s).add(src))}
        />
      )}
      <span className="visually-hidden">Cover of {title}</span>
    </div>
  )
}

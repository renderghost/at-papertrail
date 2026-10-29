/**
 * GET /api/share?kind=…: link previews for public pages (#34). Papertrail is a
 * single-page app, so a link-preview crawler (Bluesky's card fetcher, Slack,
 * Discord, iMessage…) would see an empty page. vercel.json rewrites crawler
 * requests for /books, /profile, /authors and /shelves here; people get the
 * app as usual. The answer is a tiny HTML page with Open Graph tags, built
 * from public data only. The image is the book's cover or the reader's
 * avatar, so there's nothing to render.
 *
 * Self-contained on purpose (no local imports), like api/bookhive/[method].ts.
 */

const BOOKHIVE_DID = 'did:plc:enu2j5xjlqsjaylv3du4myh4'
const APPVIEW = 'https://public.api.bsky.app'
const PLC = 'https://plc.directory'
const SITE_NAME = 'Papertrail'
const TIMEOUT_MS = 6000
const USER_AGENT = 'Papertrail/1 (+https://papertrail.renderg.host; link previews)'

const HIVE_ID = /^bk_[A-Za-z0-9]{1,64}$/
const ACTOR = /^(did:[a-z]+:[A-Za-z0-9._:%-]{1,256}|[a-zA-Z0-9.-]{1,253})$/
const RKEY = /^[A-Za-z0-9._:~-]{1,512}$/

export type Card = {
  title: string
  description: string
  /** The page's own path, e.g. /books/bk_…. */
  path: string
  image?: string
  type: 'book' | 'profile' | 'website'
}

type Fetch = typeof fetch

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function clip(text: string | undefined, max: number): string {
  const clean = (text ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean
}

export function renderCard(card: Card, origin: string): string {
  const url = `${origin}${card.path}`
  const title = escape(card.title)
  const description = escape(card.description)
  const image = card.image?.startsWith('https://') ? escape(card.image) : null
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>${title} · ${SITE_NAME}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${escape(url)}">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:type" content="${card.type}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${escape(url)}">
${image ? `<meta property="og:image" content="${image}">\n` : ''}<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
${image ? `<meta name="twitter:image" content="${image}">\n` : ''}</head>
<body>
<h1>${title}</h1>
<p>${description}</p>
<p><a href="${escape(url)}">Open on ${SITE_NAME}</a></p>
</body>
</html>
`
}

async function getJson<T>(fetchImpl: Fetch, url: string): Promise<T | null> {
  try {
    const res = await fetchImpl(url, {
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return res.ok ? ((await res.json()) as T) : null
  } catch {
    return null
  }
}

async function pdsOf(fetchImpl: Fetch, did: string): Promise<string | null> {
  if (!did.startsWith('did:plc:')) return null
  const doc = await getJson<{ service?: { id?: string; serviceEndpoint?: string }[] }>(fetchImpl, `${PLC}/${did}`)
  const pds = doc?.service?.find((s) => s.id?.endsWith('#atproto_pds'))?.serviceEndpoint
  return pds?.startsWith('https://') ? pds.replace(/\/+$/, '') : null
}

async function record<T>(fetchImpl: Fetch, pds: string, did: string, collection: string, rkey: string) {
  const params = new URLSearchParams({ repo: did, collection, rkey })
  return getJson<{ value: T }>(fetchImpl, `${pds}/xrpc/com.atproto.repo.getRecord?${params}`)
}

type CatalogBook = {
  title?: string
  authors?: string
  description?: string
  cover?: string
  thumbnail?: string
  coverBlob?: { ref?: { $link?: string } }
  numPages?: number
  publicationYear?: number
  rating?: number
}

type Profile = { did: string; handle: string; displayName?: string; description?: string; avatar?: string }

function byline(authors: string | undefined): string {
  const names = (authors ?? '').split('\t').filter(Boolean)
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '')
}

async function bookCard(fetchImpl: Fetch, hiveId: string): Promise<Card> {
  const path = `/books/${hiveId}`
  const pds = await pdsOf(fetchImpl, BOOKHIVE_DID)
  const book = pds ? (await record<CatalogBook>(fetchImpl, pds, BOOKHIVE_DID, 'buzz.bookhive.catalogBook', hiveId))?.value : null
  if (!book?.title) return { title: 'A book on Papertrail', description: 'Reading, reviews and lists from BookHive readers.', path, type: 'book' }
  const blob = book.coverBlob?.ref?.$link
  const image = blob && pds ? `${pds}/xrpc/com.atproto.sync.getBlob?did=${BOOKHIVE_DID}&cid=${blob}` : (book.cover ?? book.thumbnail)
  const facts = [
    book.rating ? `${(book.rating / 1000).toFixed(2)} average` : null,
    book.numPages ? `${book.numPages} pages` : null,
    book.publicationYear ? String(book.publicationYear) : null,
  ].filter(Boolean)
  const by = byline(book.authors)
  return {
    title: by ? `${book.title} by ${by}` : book.title,
    description: clip(book.description, 200) || facts.join(' · ') || 'On BookHive.',
    path,
    image,
    type: 'book',
  }
}

async function profileFor(fetchImpl: Fetch, actor: string): Promise<Profile | null> {
  return getJson<Profile>(fetchImpl, `${APPVIEW}/xrpc/app.bsky.actor.getProfile?${new URLSearchParams({ actor })}`)
}

async function profileCard(fetchImpl: Fetch, actor: string): Promise<Card> {
  const path = `/profile/${actor}`
  const p = await profileFor(fetchImpl, actor)
  if (!p) return { title: `@${actor}`, description: 'A reader on Papertrail.', path, type: 'profile' }
  const name = p.displayName || `@${p.handle}`
  return {
    title: `${name} on ${SITE_NAME}`,
    description: clip(p.description, 200) || `What @${p.handle} is reading, their reviews and lists.`,
    path: `/profile/${p.handle}`,
    image: p.avatar,
    type: 'profile',
  }
}

async function listCard(fetchImpl: Fetch, actor: string, rkey: string): Promise<Card> {
  const path = `/shelves/${actor}/${rkey}`
  const p = await profileFor(fetchImpl, actor)
  const pds = p ? await pdsOf(fetchImpl, p.did) : null
  const list = p && pds ? (await record<{ name?: string; description?: string }>(fetchImpl, pds, p.did, 'social.popfeed.feed.list', rkey))?.value : null
  if (!p || !list?.name) return { title: 'A book list on Papertrail', description: 'A list of books from a BookHive reader.', path, type: 'website' }
  return {
    title: `${list.name} · a list by ${p.displayName || `@${p.handle}`}`,
    description: clip(list.description, 200) || `A book list by @${p.handle}.`,
    path: `/shelves/${p.handle}/${rkey}`,
    image: p.avatar,
    type: 'website',
  }
}

async function authorCard(fetchImpl: Fetch, name: string): Promise<Card> {
  // The author's most popular book's cover stands in for a portrait.
  const params = new URLSearchParams({ author: name, limit: '1', sort: 'popularity' })
  const books = await getJson<{ books?: CatalogBook[]; totalBooks?: number }>(
    fetchImpl,
    `https://bookhive.buzz/xrpc/buzz.bookhive.getAuthorBooks?${params}`,
  )
  const top = books?.books?.[0]
  return {
    title: `${name} · books on ${SITE_NAME}`,
    description: top?.title
      ? `${books?.totalBooks ? `${books.totalBooks} books` : 'Books'} by ${name}, including ${top.title}. What readers thought, and which ones you've read.`
      : `Books by ${name}, what readers thought, and which ones you've read.`,
    path: `/authors/${encodeURIComponent(name)}`,
    image: top?.cover ?? top?.thumbnail,
    type: 'website',
  }
}

/** Which card a request asks for, or null when its parameters aren't valid. */
export async function cardFor(url: URL, fetchImpl: Fetch): Promise<Card | null> {
  const q = url.searchParams
  switch (q.get('kind')) {
    case 'book': {
      const id = q.get('id') ?? ''
      return HIVE_ID.test(id) ? bookCard(fetchImpl, id) : null
    }
    case 'profile': {
      const actor = q.get('actor') ?? ''
      return ACTOR.test(actor) ? profileCard(fetchImpl, actor) : null
    }
    case 'shelf': {
      const actor = q.get('actor') ?? ''
      const rkey = q.get('rkey') ?? ''
      return ACTOR.test(actor) && RKEY.test(rkey) ? listCard(fetchImpl, actor, rkey) : null
    }
    case 'author': {
      const name = (q.get('name') ?? '').trim()
      return name && name.length <= 200 ? authorCard(fetchImpl, name) : null
    }
    default:
      return null
  }
}

export async function handle(request: Request, fetchImpl: Fetch = fetch): Promise<Response> {
  const url = new URL(request.url)
  const card = (await cardFor(url, fetchImpl)) ?? {
    title: SITE_NAME,
    description: 'A social reading client for BookHive on the AT Protocol.',
    path: '/',
    type: 'website' as const,
  }
  return new Response(renderCard(card, url.origin), {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Crawlers only (vercel.json routes by user-agent); edits show within the hour.
      'cache-control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}

export function GET(request: Request): Promise<Response> {
  return handle(request)
}

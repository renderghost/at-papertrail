/**
 * GET /api/bookhive/:method: relays an allowlist of BookHive's public XRPC
 * queries. bookhive.buzz sends no CORS headers, so a browser on another origin
 * can't call it directly (#33, retire once #42 or #43 lands upstream).
 *
 * Read-only and anonymous: no cookies or credentials are forwarded, the
 * upstream host is fixed, and only listed parameters pass through. Vercel's CDN
 * caches each answer for the method's TTL, so repeat traffic never reaches
 * BookHive.
 *
 * Self-contained on purpose (no local imports): Vercel compiles this file on
 * its own, and the Vite dev server and the tests import the same file.
 */

const UPSTREAM = 'https://bookhive.buzz/xrpc/buzz.bookhive.'
const USER_AGENT = 'Papertrail/1 (+https://papertrail.renderg.host; BookHive client)'
const TIMEOUT_MS = 10_000
const MAX_BYTES = 2_000_000
const MAX_PARAM_LENGTH = 512

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

type Rule = { params: readonly string[]; ttl: number }

/** Unauthenticated `buzz.bookhive.*` queries, their parameters and how long the CDN keeps them. */
export const METHODS: Readonly<Record<string, Rule>> = {
  searchBooks: { params: ['q', 'genre', 'limit', 'offset', 'id', 'language'], ttl: HOUR },
  getBook: { params: ['id', 'isbn10', 'isbn13', 'goodreadsId'], ttl: 10 * MINUTE },
  getBookIdentifiers: { params: ['hiveId', 'isbn10', 'isbn13', 'goodreadsId'], ttl: DAY },
  getAuthorBooks: { params: ['author', 'page', 'limit', 'sort', 'language'], ttl: 6 * HOUR },
  getExplore: { params: ['language'], ttl: 6 * HOUR },
  listGenres: { params: ['limit', 'offset', 'minBooks'], ttl: DAY },
  getLanguages: { params: [], ttl: DAY },
  getProfile: { params: ['did', 'handle'], ttl: 5 * MINUTE },
  getReadingStats: { params: ['handle', 'year'], ttl: HOUR },
  getUserLists: { params: ['did'], ttl: 5 * MINUTE },
  getList: { params: ['uri'], ttl: 5 * MINUTE },
}

function json(status: number, body: unknown, cacheControl: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cacheControl },
  })
}

function problem(status: number, error: string, message: string, cacheControl = 'no-store'): Response {
  return json(status, { error, message }, cacheControl)
}

/** Builds the upstream URL, or explains why the request can't be relayed. */
export function upstreamUrl(requestUrl: string): { url: string; rule: Rule } | { status: number; error: string; message: string } {
  const url = new URL(requestUrl)
  // Vercel routes /api/bookhive/x to this file as /api/bookhive/[method]?method=x; the dev server passes the path as is.
  const method = url.searchParams.get('method') ?? decodeURIComponent(url.pathname.replace(/\/+$/, '').split('/').pop() ?? '')
  url.searchParams.delete('method')
  const rule = Object.hasOwn(METHODS, method) ? METHODS[method] : undefined
  if (!rule) return { status: 404, error: 'MethodNotSupported', message: `buzz.bookhive.${method} isn't relayed.` }

  const upstream = new URLSearchParams()
  const seen = new Set<string>()
  for (const [key, value] of url.searchParams) {
    if (!rule.params.includes(key)) {
      return { status: 400, error: 'InvalidRequest', message: `Unknown parameter "${key}" for ${method}.` }
    }
    if (seen.has(key)) return { status: 400, error: 'InvalidRequest', message: `Parameter "${key}" given twice.` }
    if (value.length > MAX_PARAM_LENGTH) {
      return { status: 400, error: 'InvalidRequest', message: `Parameter "${key}" is too long.` }
    }
    seen.add(key)
    upstream.set(key, value)
  }
  const query = upstream.toString()
  return { url: `${UPSTREAM}${method}${query ? `?${query}` : ''}`, rule }
}

export async function handle(request: Request, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
  }
  const target = upstreamUrl(request.url)
  if (!('url' in target)) {
    // Bad requests are cacheable for a minute, so a hot broken link can't hammer the function.
    return problem(target.status, target.error, target.message, 'public, max-age=60, s-maxage=60')
  }

  let res: Response
  try {
    res = await fetchImpl(target.url, {
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    return problem(502, 'UpstreamUnavailable', "BookHive didn't answer. Try again in a moment.")
  }

  const length = Number(res.headers.get('content-length') ?? 0)
  if (length > MAX_BYTES) return problem(502, 'UpstreamTooLarge', "BookHive's answer was too large to relay.")
  const text = await res.text().catch(() => null)
  if (text === null || text.length > MAX_BYTES) {
    return problem(502, 'UpstreamTooLarge', "BookHive's answer was too large to relay.")
  }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return problem(502, 'UpstreamInvalid', "BookHive's answer wasn't JSON.")
  }

  const { ttl } = target.rule
  if (res.ok) {
    // Browsers keep it for a minute; the CDN for the method's TTL, serving stale while it refreshes.
    return json(200, body, `public, max-age=60, s-maxage=${ttl}, stale-while-revalidate=${ttl * 4}`)
  }
  if (res.status >= 400 && res.status < 500) {
    // XRPC errors (e.g. NotFound) pass through with a short cache.
    return json(res.status, body, 'public, max-age=60, s-maxage=300')
  }
  return problem(502, 'UpstreamError', `BookHive answered ${res.status}. Try again in a moment.`)
}

export function GET(request: Request): Promise<Response> {
  return handle(request)
}

export function HEAD(request: Request): Promise<Response> {
  return handle(request)
}

#!/usr/bin/env node
/**
 * Checks a deployed Papertrail can actually sign people in, the way a PDS and a
 * browser see it. Used by .github/workflows/verify-deployment.yml after each
 * production deployment; run it yourself with:
 *
 *   npm run check:deployment -- https://papertrail.renderg.host/
 *
 * Options:
 *   --retries <n>   attempts for the first request, 20 s apart (default 1),
 *                   for CDNs and domain aliases that take a moment to update
 *   --expect-vercel fail unless the site is served by Vercel
 *   --fetch-from <origin>  request this origin instead of the site's own (for
 *                   testing a build locally; the checks still expect the site URL)
 */

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}
const positional = args.filter((a, i) => !a.startsWith('--') && !['--retries', '--fetch-from'].includes(args[i - 1]))
const site = positional[0] && new URL(positional[0].endsWith('/') ? positional[0] : `${positional[0]}/`)
if (!site) {
  console.error('Usage: check-deployment.mjs <site-url> [--retries n] [--expect-vercel] [--fetch-from origin]')
  process.exit(2)
}
const retries = Number(option('--retries', '1'))
const fetchFrom = option('--fetch-from', site.origin)
const at = (path) => new URL(`${site.pathname.replace(/\/$/, '')}${path}`, fetchFrom).href

const results = []
const pass = (name, detail = '') => results.push({ ok: true, name, detail })
const fail = (name, detail) => results.push({ ok: false, name, detail })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** No redirects: a PDS fetching client metadata must not be redirected. */
async function get(path) {
  const res = await fetch(at(path), { redirect: 'manual', headers: { 'user-agent': 'papertrail-deployment-check' } })
  return { res, body: await res.text() }
}

const clientId = `${site.href}client-metadata.json`

// 1. Client metadata: what every PDS fetches during sign-in.
let meta
for (let attempt = 1; attempt <= retries; attempt++) {
  try {
    meta = await get('/client-metadata.json')
    if (meta.res.status === 200) break
  } catch (err) {
    meta = { error: err }
  }
  if (attempt < retries) {
    console.log(`Attempt ${attempt}: ${meta.error ? meta.error.message : `HTTP ${meta.res.status}`}; retrying in 20 s…`)
    await sleep(20_000)
  }
}

if (meta.error) {
  fail('client-metadata.json is reachable', meta.error.message)
} else {
  const { res, body } = meta
  const server = res.headers.get('server') ?? '(none)'
  if (res.status === 200) pass('client-metadata.json returns 200 without a redirect')
  else if (res.status >= 300 && res.status < 400) fail('client-metadata.json returns 200 without a redirect', `HTTP ${res.status} → ${res.headers.get('location')} (PDSes don't follow redirects for client metadata)`)
  else fail('client-metadata.json returns 200 without a redirect', `HTTP ${res.status} from server "${server}"${res.status === 401 ? ' (Deployment Protection?)' : ''}`)

  if (flag('--expect-vercel')) {
    if (/vercel/i.test(server)) pass('served by Vercel')
    else fail('served by Vercel', `server is "${server}": DNS for ${site.host} doesn't point at Vercel yet (CNAME to the target shown in Vercel → Domains, DNS only)`)
  }

  if (res.status === 200) {
    if (/application\/json/.test(res.headers.get('content-type') ?? '')) pass('client-metadata.json is application/json')
    else fail('client-metadata.json is application/json', res.headers.get('content-type'))
    let doc
    try {
      doc = JSON.parse(body)
    } catch {
      fail('client-metadata.json parses', body.slice(0, 120))
    }
    if (doc) {
      if (doc.client_id === clientId) pass('client_id is its own URL', clientId)
      else fail('client_id is its own URL', `expected ${clientId}, got ${doc.client_id}`)
      if (Array.isArray(doc.redirect_uris) && doc.redirect_uris.includes(site.href)) pass('redirect_uris include the site')
      else fail('redirect_uris include the site', JSON.stringify(doc.redirect_uris))
      if (typeof doc.scope === 'string' && doc.scope.split(' ').includes('atproto')) pass('scope includes atproto', doc.scope)
      else fail('scope includes atproto', doc.scope)
      if (doc.dpop_bound_access_tokens === true && doc.token_endpoint_auth_method === 'none') pass('public DPoP client')
      else fail('public DPoP client', JSON.stringify({ dpop: doc.dpop_bound_access_tokens, auth: doc.token_endpoint_auth_method }))
    }
  }
}

// 2. The app itself, with its security headers.
try {
  const { res, body } = await get('/')
  if (res.status === 200 && body.includes('<div id="root">')) pass('the site serves the app')
  else fail('the site serves the app', `HTTP ${res.status}`)
  for (const header of ['content-security-policy', 'strict-transport-security', 'x-content-type-options', 'referrer-policy']) {
    if (res.headers.get(header)) pass(`${header} header`)
    else fail(`${header} header`, 'missing (is vercel.json deployed?)')
  }
} catch (err) {
  fail('the site serves the app', err.message)
}

// 3. Routing: deep links serve the app; missing assets are real 404s.
try {
  const { res, body } = await get('/feed')
  if (res.status === 200 && body.includes('<div id="root">')) pass('deep links serve the app')
  else fail('deep links serve the app', `HTTP ${res.status}`)
  const missing = await get('/assets/deployment-check-missing.js')
  if (missing.res.status === 404) pass('missing assets return 404')
  else fail('missing assets return 404', `HTTP ${missing.res.status}`)
} catch (err) {
  fail('routing', err.message)
}

console.log(`\nDeployment check for ${site.href}${fetchFrom !== site.origin ? ` (fetched from ${fetchFrom})` : ''}`)
for (const r of results) console.log(`${r.ok ? '  ✓' : '  ✗'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
const failed = results.filter((r) => !r.ok)
if (failed.length) {
  console.log(`\n${failed.length} check(s) failed. See docs/deployment.md → Troubleshooting.`)
  process.exit(1)
}
console.log('\nAll checks passed: a PDS can load the client metadata and sign-in can work.')

/// <reference types="vitest/config" />
import type { ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { clientMetadata } from './src/lib/oauthConfig.ts'
import { resolveSiteUrl, type ResolvedSiteUrl } from './src/lib/siteUrl.ts'

/**
 * Publishes /client-metadata.json for the build's site URL: emitted into the
 * build, and served by the dev server so the document can be inspected locally
 * (local sign-in itself uses atproto's loopback client and never reads it).
 */
function oauthClientMetadata(site: ResolvedSiteUrl | null, strict: boolean): Plugin {
  return {
    name: 'papertrail-oauth-client-metadata',
    configureServer(server) {
      server.middlewares.use((req: { url?: string }, res: ServerResponse, next: () => void) => {
        if ((req.url ?? '').split('?')[0] !== '/client-metadata.json') return next()
        if (!site) {
          res.statusCode = 404
          res.end('No site URL configured; local sign-in uses the loopback OAuth client.')
          return
        }
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(clientMetadata(site.url), null, 2))
      })
    },
    generateBundle() {
      if (!site) {
        const message =
          'No site URL: client-metadata.json was not generated, so this build can only sign in on 127.0.0.1. ' +
          'On Vercel the URL comes from its system environment variables; elsewhere set VITE_SITE_URL ' +
          '(e.g. https://papertrail.renderg.host/). See docs/deployment.md.'
        // A deployed build without metadata would fail every sign-in, so refuse on Vercel and in CI.
        if (strict) this.error(message)
        else this.warn(message)
        return
      }
      this.info?.(`OAuth client_id: ${site.url}client-metadata.json (site URL from ${site.source})`)
      this.emitFile({
        type: 'asset',
        fileName: 'client-metadata.json',
        source: `${JSON.stringify(clientMetadata(site.url), null, 2)}\n`,
      })
    },
  }
}

export default defineConfig(({ command, mode, isPreview }) => {
  // With an empty prefix, loadEnv returns .env files plus every process variable, VERCEL_* included.
  const env = loadEnv(mode, process.cwd(), '')
  const site = resolveSiteUrl(env)
  const strict = env.VERCEL === '1' || env.CI === 'true'
  return {
    // The built app (and `vite preview` of it) lives under the site URL's path: "/" on Vercel.
    base: (command === 'build' || isPreview) && site ? new URL(site.url).pathname : '/',
    define: {
      // The URL this build's OAuth metadata describes; the app refuses to start sign-in anywhere else.
      __SITE_URL__: JSON.stringify(site?.url ?? ''),
    },
    plugins: [react(), oauthClientMetadata(site, strict)],
    // Serve dev over the loopback IP, which atproto's loopback OAuth client requires.
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    preview: { host: '127.0.0.1' },
    test: { environment: 'node' },
  }
})

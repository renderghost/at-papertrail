/// <reference types="vitest/config" />
import { existsSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { clientMetadata, normaliseSiteUrl } from './src/lib/oauthConfig.ts'

/** The public URL the site is served from (origin plus path), from VITE_SITE_URL. Empty if unset. */
function siteUrl(mode: string): string {
  const explicit = loadEnv(mode, process.cwd(), '').VITE_SITE_URL?.trim()
  return explicit ? normaliseSiteUrl(explicit) : ''
}

/**
 * Publishes /client-metadata.json for the configured site URL: emitted into the
 * build, and served by the dev server so the document can be inspected locally
 * (local sign-in itself uses atproto's loopback client and never reads it).
 */
function oauthClientMetadata(mode: string): Plugin {
  return {
    name: 'papertrail-oauth-client-metadata',
    configureServer(server) {
      server.middlewares.use((req: { url?: string }, res: ServerResponse, next: () => void) => {
        if ((req.url ?? '').split('?')[0] !== '/client-metadata.json') return next()
        const site = siteUrl(mode)
        if (!site) {
          res.statusCode = 404
          res.end('No VITE_SITE_URL configured; local sign-in uses the loopback OAuth client.')
          return
        }
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(clientMetadata(site), null, 2))
      })
    },
    generateBundle() {
      const site = siteUrl(mode)
      if (!site) {
        this.error(
          'No public site URL is configured, so the OAuth client metadata cannot be generated and sign-in ' +
            'would fail in production. Set VITE_SITE_URL (e.g. https://renderghost.github.io/at-papertrail/).',
        )
        return
      }
      this.emitFile({
        type: 'asset',
        fileName: 'client-metadata.json',
        source: `${JSON.stringify(clientMetadata(site), null, 2)}\n`,
      })
    },
  }
}

/** GitHub Pages serves 404.html for unknown paths; a copy of the app makes deep links work. */
function spaFallback(): Plugin {
  let outDir = 'dist'
  return {
    name: 'papertrail-spa-fallback',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    async closeBundle() {
      const index = resolve(outDir, 'index.html')
      // A failed build has no index.html; don't bury its real error under ours.
      if (existsSync(index)) await copyFile(index, resolve(outDir, '404.html'))
    },
  }
}

export default defineConfig(({ command, mode, isPreview }) => {
  const site = siteUrl(mode)
  return {
    // The built app (and `vite preview` of it) lives under the site URL's path, e.g. /at-papertrail/.
    base: (command === 'build' || isPreview) && site ? new URL(site).pathname : '/',
    plugins: [react(), oauthClientMetadata(mode), spaFallback()],
    // Serve dev over the loopback IP, which atproto's loopback OAuth client requires.
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    preview: { host: '127.0.0.1' },
    test: { environment: 'node' },
  }
})

import { describe, expect, it } from 'vitest'
import { originMismatch, resolveSiteUrl } from './siteUrl'

describe('resolveSiteUrl', () => {
  it('uses the production domain for Vercel production builds', () => {
    expect(
      resolveSiteUrl({
        VERCEL_ENV: 'production',
        VERCEL_URL: 'at-papertrail-abc123-renderghost.vercel.app',
        VERCEL_PROJECT_PRODUCTION_URL: 'papertrail.renderg.host',
      }),
    ).toEqual({ url: 'https://papertrail.renderg.host/', source: 'VERCEL_PROJECT_PRODUCTION_URL' })
  })

  it("uses a preview deployment's own URL", () => {
    expect(
      resolveSiteUrl({
        VERCEL_ENV: 'preview',
        VERCEL_URL: 'at-papertrail-git-feature-renderghost.vercel.app',
        VERCEL_PROJECT_PRODUCTION_URL: 'papertrail.renderg.host',
      }),
    ).toEqual({ url: 'https://at-papertrail-git-feature-renderghost.vercel.app/', source: 'VERCEL_URL' })
  })

  it('never lets a preview claim to be production, even with VITE_SITE_URL set everywhere', () => {
    expect(
      resolveSiteUrl({
        VITE_SITE_URL: 'https://papertrail.renderg.host/',
        VERCEL_ENV: 'preview',
        VERCEL_URL: 'at-papertrail-xyz.vercel.app',
      })?.url,
    ).toBe('https://at-papertrail-xyz.vercel.app/')
  })

  it('lets an explicit VITE_SITE_URL pin production or configure another host', () => {
    expect(
      resolveSiteUrl({
        VITE_SITE_URL: 'https://reading.example.com',
        VERCEL_ENV: 'production',
        VERCEL_PROJECT_PRODUCTION_URL: 'at-papertrail.vercel.app',
      }),
    ).toEqual({ url: 'https://reading.example.com/', source: 'VITE_SITE_URL' })
    expect(resolveSiteUrl({ VITE_SITE_URL: 'https://renderghost.github.io/at-papertrail' })?.url).toBe(
      'https://renderghost.github.io/at-papertrail/',
    )
  })

  it('returns null for local builds and vercel dev', () => {
    expect(resolveSiteUrl({})).toBeNull()
    expect(resolveSiteUrl({ VERCEL_ENV: 'development', VERCEL_URL: 'localhost:3000' })).toBeNull()
    expect(resolveSiteUrl({ VITE_SITE_URL: '   ' })).toBeNull()
  })

  it('rejects URLs that cannot be OAuth client ids', () => {
    expect(() => resolveSiteUrl({ VITE_SITE_URL: 'http://papertrail.renderg.host/' })).toThrow(/https/)
    expect(() => resolveSiteUrl({ VITE_SITE_URL: 'papertrail.renderg.host' })).toThrow(/valid URL/)
    expect(() => resolveSiteUrl({ VITE_SITE_URL: 'https://example.com/?x=1' })).toThrow(/query/)
  })
})

describe('originMismatch', () => {
  const site = 'https://papertrail.renderg.host/'

  it('allows the site itself and loopback origins', () => {
    expect(originMismatch('https://papertrail.renderg.host', site)).toBeNull()
    expect(originMismatch('http://127.0.0.1:5173', site)).toBeNull()
    expect(originMismatch('http://localhost:4173', site)).toBeNull()
  })

  it('explains where sign-in works when opened elsewhere', () => {
    expect(originMismatch('https://at-papertrail-abc123-renderghost.vercel.app', site)).toBe(
      "Sign-in works at https://papertrail.renderg.host/ — you're on at-papertrail-abc123-renderghost.vercel.app, which can't sign you in.",
    )
  })

  it('has nothing to compare against when the build has no site URL', () => {
    expect(originMismatch('https://anything.example', '')).toBeNull()
  })
})

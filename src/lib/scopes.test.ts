import { describe, expect, it } from 'vitest'
import { grants } from './scopes'

describe('grants', () => {
  const old = 'atproto repo:buzz.bookhive.book'
  it('finds a repo scope by collection', () => {
    expect(grants(old, 'repo:buzz.bookhive.book')).toBe(true)
    expect(grants(old, 'repo:social.popfeed.feed.list')).toBe(false)
  })

  it('treats a scope without actions as every action, and checks listed ones', () => {
    const scope = 'atproto repo:app.bsky.graph.follow?action=create&action=delete repo:social.popfeed.feed.list'
    expect(grants(scope, 'repo:app.bsky.graph.follow?action=create&action=delete')).toBe(true)
    expect(grants('atproto repo:app.bsky.graph.follow?action=create', 'repo:app.bsky.graph.follow?action=create&action=delete')).toBe(false)
    expect(grants(scope, 'repo:social.popfeed.feed.list?action=create')).toBe(true)
  })

  it('honours wildcards and the legacy generic scope', () => {
    expect(grants('atproto repo:*', 'repo:social.popfeed.feed.list')).toBe(true)
    expect(grants('atproto transition:generic', 'repo:app.bsky.graph.follow?action=create')).toBe(true)
    expect(grants('', 'repo:buzz.bookhive.book')).toBe(false)
  })
})

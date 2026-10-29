import { describe, expect, it } from 'vitest'
import { isTid, nextTid } from './tid'

describe('nextTid', () => {
  it('makes valid, strictly increasing keys even within one millisecond', () => {
    const at = () => 1_793_300_000_000
    const keys = [nextTid(at), nextTid(at), nextTid(at)]
    for (const k of keys) expect(isTid(k)).toBe(true)
    expect([...keys].sort()).toEqual(keys)
    expect(new Set(keys).size).toBe(3)
  })

  it('sorts like time', () => {
    expect(nextTid(() => 1_700_000_000_000) < nextTid(() => 1_800_000_000_000)).toBe(true)
  })

  it('matches the shape of real keys', () => {
    expect(isTid('3lz3ead6kek2v')).toBe(true)
    expect(isTid('self')).toBe(false)
  })
})

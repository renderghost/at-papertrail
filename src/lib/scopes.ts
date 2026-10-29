/**
 * Whether a granted OAuth scope string covers a `repo:` scope Papertrail asks
 * for. Sessions from before a new scope was added lack it until the reader
 * signs in again.
 */
export function grants(granted: string, wanted: string): boolean {
  const tokens = granted.split(/\s+/).filter(Boolean)
  if (tokens.includes('transition:generic')) return true
  const [resource, query = ''] = wanted.split('?')
  const wantedActions = new URLSearchParams(query).getAll('action')
  return tokens.some((token) => {
    const [res, q = ''] = token.split('?')
    if (res !== resource && res !== 'repo:*') return false
    const actions = new URLSearchParams(q).getAll('action')
    // No actions listed means every action.
    return actions.length === 0 || (wantedActions.length > 0 && wantedActions.every((a) => actions.includes(a)))
  })
}

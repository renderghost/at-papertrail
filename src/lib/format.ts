/** Display helpers, in British English. */

const DAY = 86_400_000

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** "14 Mar 2025". Reading dates are UTC midnights, so they're shown in UTC. */
export function formatDate(iso: string | undefined | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : dateFormat.format(d)
}

/** "Today", "Yesterday", "3 days ago", then "14 Mar" or "14 Mar 2024". */
export function formatRelativeDay(iso: string, now = Date.now()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate())
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const diff = Math.round((today - day) / DAY)
  if (diff <= 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return `${diff} days ago`
  return d.getUTCFullYear() === new Date(now).getUTCFullYear() ? shortDate.format(d) : dateFormat.format(d)
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).trimEnd()}…`
}

export function displayName(profile: { handle: string; displayName?: string }): string {
  return profile.displayName || `@${profile.handle}`
}

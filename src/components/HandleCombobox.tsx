import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useId, useState, type KeyboardEvent } from 'react'
import { useDebounced } from '../lib/hooks'
import { searchActors, typeaheadQuery, type ActorSuggestion } from '../lib/typeahead'
import { Avatar } from './bits'

const DEBOUNCE_MS = 150

/** The CDN avatar, then the copy on the account's own PDS, then an initial. */
function SuggestionAvatar({ actor }: { actor: ActorSuggestion }) {
  const sources = [actor.avatar, actor.avatarFallback].filter((s): s is string => !!s)
  const [failed, setFailed] = useState(0)
  const src = sources[failed]
  if (!src) return <Avatar profile={{ handle: actor.handle, displayName: actor.displayName }} size={28} />
  return <img className="avatar" src={src} alt="" width={28} height={28} loading="lazy" onError={() => setFailed(failed + 1)} />
}

type Props = {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  invalid?: boolean
  describedBy?: string
}

/**
 * A handle field that suggests accounts as you type (an ARIA 1.2 combobox).
 * ↑/↓ move through suggestions, Enter picks the highlighted one, Escape closes.
 * Enter with nothing highlighted is left alone, so it still submits the form.
 */
export function HandleCombobox({ id, value, onChange, placeholder, invalid, describedBy }: Props) {
  const listId = useId()
  // Open only after typing (or ↓), so a picked handle doesn't reopen the menu.
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const query = typeaheadQuery(useDebounced(value, DEBOUNCE_MS))
  const suggestions = useQuery({
    queryKey: ['typeahead', query],
    queryFn: ({ signal }) => searchActors(query!, signal),
    enabled: open && query !== null,
    staleTime: 60_000,
    retry: false,
    placeholderData: keepPreviousData,
  })
  const typed = typeaheadQuery(value)
  const results = typed !== null && query !== null ? (suggestions.data ?? []) : []
  // A complete handle needs no menu, and the menu would cover the sign-in button.
  const actors = results.some((a) => a.handle === typed) ? [] : results
  const expanded = open && actors.length > 0
  const current = expanded && active < actors.length ? active : -1
  const optionId = (i: number) => `${listId}-${i}`

  const pick = (actor: ActorSuggestion) => {
    onChange(actor.handle)
    setOpen(false)
    setActive(-1)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Keys that finish an IME composition (e.g. a Japanese display name) aren't ours.
    if (e.nativeEvent.isComposing) return
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (!expanded) {
          setOpen(true)
          setActive(actors.length ? 0 : -1)
        } else setActive((current + 1) % actors.length)
        break
      case 'ArrowUp':
        if (!expanded) return
        e.preventDefault()
        setActive(current <= 0 ? actors.length - 1 : current - 1)
        break
      case 'Escape':
        if (!expanded) return
        e.preventDefault()
        setOpen(false)
        setActive(-1)
        break
      case 'Enter':
        if (current < 0) return
        e.preventDefault()
        pick(actors[current]!)
        break
    }
  }

  return (
    <div className="typeahead">
      <input
        id={id}
        className="input"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={current >= 0 ? optionId(current) : undefined}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        placeholder={placeholder}
        // The browser's own autofill menu would sit on top of ours.
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setOpen(false)
          setActive(-1)
        }}
      />
      {/* Clicks inside keep focus on the field, so the menu doesn't close before a pick lands. */}
      <div className="typeahead-menu" hidden={!expanded} onMouseDown={(e) => e.preventDefault()}>
        <ul id={listId} role="listbox" aria-label="Matching accounts">
          {expanded &&
            actors.map((actor, i) => (
              <li
                key={actor.did}
                id={optionId(i)}
                role="option"
                aria-selected={i === current}
                className="typeahead-option"
                onClick={() => pick(actor)}
                onMouseMove={() => i !== current && setActive(i)}
              >
                <SuggestionAvatar actor={actor} />
                <span className="typeahead-names">
                  {actor.displayName && <span className="typeahead-name">{actor.displayName}</span>}
                  <span className="typeahead-handle">@{actor.handle}</span>
                </span>
              </li>
            ))}
        </ul>
        <p className="typeahead-credit" aria-hidden="true">
          Suggestions from typeahead.waow.tech
        </p>
      </div>
      <p className="visually-hidden" role="status">
        {expanded ? `${actors.length === 1 ? '1 matching account' : `${actors.length} matching accounts`}. Use the arrow keys to choose.` : ''}
      </p>
    </div>
  )
}

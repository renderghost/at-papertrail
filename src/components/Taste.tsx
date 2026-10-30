import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { BookEntry } from '../lib/bookhive/types'
import { displayName } from '../lib/format'
import { bookPath } from '../lib/paths'
import { describeMatch, type Shared, type TasteMatch } from '../lib/taste'
import { Stars } from './bits'
import { Cover } from './Cover'
import { QuickAdd } from './QuickAdd'

/** "84% match", with what it's based on. */
export function MatchLine({ match }: { match: TasteMatch }) {
  const { headline, detail } = describeMatch(match)
  return (
    <div className="match-line">
      <strong className={match.score === null ? 'muted' : undefined}>{headline}</strong>
      <span className="small muted">{detail}</span>
    </div>
  )
}

function BookCard({ entry, children }: { entry: BookEntry; children?: ReactNode }) {
  const v = entry.value
  return (
    <li>
      <Link to={bookPath(v.hiveId)} tabIndex={-1} aria-hidden="true">
        <Cover hiveId={v.hiveId} title={v.title} authors={v.authors} entry={entry} size="sm" />
      </Link>
      <Link className="name" to={bookPath(v.hiveId)}>
        {v.title}
      </Link>
      {children}
    </li>
  )
}

/** A profile's "you and them" (#63): your match, books you both loved, where you disagree, and their picks for you. */
export function TasteSection({ match, name }: { match: TasteMatch; name: string }) {
  if (!match.shared.length && !match.theirPicks.length) return null
  return (
    <section className="section taste">
      <div className="section-title">
        <h2>You and {name}</h2>
      </div>
      <MatchLine match={match} />

      {match.bothLoved.length > 0 && (
        <>
          <h3 className="club-group-label">You both loved</h3>
          <ul className="series-strip">
            {match.bothLoved.slice(0, 12).map((s) => (
              <BookCard key={s.mine.uri} entry={s.mine} />
            ))}
          </ul>
        </>
      )}

      {match.disagreements.length > 0 && (
        <>
          <h3 className="club-group-label">Where you disagree most</h3>
          <ul className="members">
            {match.disagreements.slice(0, 5).map((s) => (
              <Disagreement key={s.mine.uri} pair={s} name={name} />
            ))}
          </ul>
        </>
      )}

      {match.theirPicks.length > 0 && (
        <>
          <h3 className="club-group-label">Their favourites you haven't read</h3>
          <ul className="series-strip">
            {match.theirPicks.slice(0, 12).map((b) => (
              <BookCard key={b.uri} entry={b}>
                <Stars stars={b.value.stars} size={12} />
                <QuickAdd book={{ hiveId: b.value.hiveId, title: b.value.title, authors: b.value.authors, identifiers: b.value.identifiers, catalog: null }} />
              </BookCard>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function Disagreement({ pair, name }: { pair: Shared; name: string }) {
  const v = pair.mine.value
  return (
    <li className="member">
      <Link to={bookPath(v.hiveId)} tabIndex={-1} aria-hidden="true">
        <Cover hiveId={v.hiveId} title={v.title} authors={v.authors} entry={pair.mine} size="sm" />
      </Link>
      <div className="body">
        <Link className="name" to={bookPath(v.hiveId)}>
          {v.title}
        </Link>
        <div className="small disagreement">
          <span>
            You <Stars stars={pair.myStars} size={12} />
          </span>
          <span>
            {name} <Stars stars={pair.theirStars} size={12} />
          </span>
        </div>
      </div>
    </li>
  )
}

export const shortName = (profile: { handle: string; displayName?: string }) => displayName(profile).split(' ')[0] || profile.handle

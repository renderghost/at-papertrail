import type { BookEntry } from '../lib/bookhive/types'
import { displayName } from '../lib/format'
import { describeMatch, type Shared, type TasteMatch } from '../lib/taste'
import { Stars } from './bits'
import { BookCard, CardGrid } from './Cards'

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
          <CardGrid size="grid" label="You both loved">
            {match.bothLoved.slice(0, 10).map((s) => (
              <BookCard key={s.mine.uri} book={cardBook(s.mine)} state={{ entry: s.mine }} context={<Both pair={s} name={name} />} />
            ))}
          </CardGrid>
        </>
      )}

      {match.disagreements.length > 0 && (
        <>
          <h3 className="club-group-label">Where you disagree most</h3>
          <CardGrid size="grid" label="Where you disagree most">
            {match.disagreements.slice(0, 5).map((s) => (
              <BookCard key={s.mine.uri} book={cardBook(s.mine)} state={{ entry: s.mine }} status={false} context={<Both pair={s} name={name} />} />
            ))}
          </CardGrid>
        </>
      )}

      {match.theirPicks.length > 0 && (
        <>
          <h3 className="club-group-label">Their favourites you haven't read</h3>
          <CardGrid size="grid" label="Their favourites you haven't read">
            {match.theirPicks.slice(0, 10).map((b) => (
              <BookCard key={b.uri} book={cardBook(b)} context={<Stars stars={b.value.stars} size={12} />} />
            ))}
          </CardGrid>
        </>
      )}
    </section>
  )
}

const cardBook = (e: BookEntry) => ({ hiveId: e.value.hiveId, title: e.value.title, authors: e.value.authors, identifiers: e.value.identifiers, entry: e })

/** Both ratings side by side. */
function Both({ pair, name }: { pair: Shared; name: string }) {
  return (
    <p className="disagreement">
      <span>
        You <Stars stars={pair.myStars} size={12} />
      </span>
      <span>
        {name} <Stars stars={pair.theirStars} size={12} />
      </span>
    </p>
  )
}

export const shortName = (profile: { handle: string; displayName?: string }) => displayName(profile).split(' ')[0] || profile.handle

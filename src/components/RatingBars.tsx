import { ratingShares } from '../lib/bookhive/series'
import { plural } from '../lib/format'

/** How a book's ratings spread across one to five stars, at the catalogue's source. */
export function RatingBars({ distribution, source }: { distribution: unknown; source?: string }) {
  const shares = ratingShares(distribution)
  if (!shares) return null
  const total = shares.reduce((n, s) => n + s.count, 0)
  return (
    <figure className="rating-bars">
      <figcaption className="small muted">
        {plural(total, 'rating')}
        {source ? ` on ${source}` : ''}
      </figcaption>
      <table>
        <tbody>
          {[...shares].reverse().map((s) => (
            <tr key={s.stars}>
              <th scope="row">{s.stars}★</th>
              <td>
                <span className="bar" aria-hidden="true">
                  <span style={{ width: `${Math.max(s.share * 100, s.count ? 1 : 0)}%` }} />
                </span>
              </td>
              <td className="pct">{Math.round(s.share * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

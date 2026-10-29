import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { authorPath } from '../lib/paths'

/** "by A, B and C", each name linking to its author page. `authors` is BookHive's tab-separated list. */
export function AuthorLinks({ authors }: { authors: string }) {
  const names = authors
    .split('\t')
    .map((a) => a.trim())
    .filter(Boolean)
  return (
    <>
      {names.map((name, i) => (
        <Fragment key={`${name}-${i}`}>
          {i > 0 && (i === names.length - 1 ? ' and ' : ', ')}
          <Link to={authorPath(name)}>{name}</Link>
        </Fragment>
      ))}
    </>
  )
}

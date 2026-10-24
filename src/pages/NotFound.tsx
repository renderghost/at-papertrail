import { Link } from 'react-router-dom'
import { Empty } from '../components/bits'

export function NotFound() {
  return (
    <Empty title="This page isn't on the shelf">
      <p>The link may be out of date.</p>
      <Link className="btn" to="/">
        Back to your library
      </Link>
    </Empty>
  )
}

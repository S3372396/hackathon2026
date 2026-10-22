import { Link } from 'react-router-dom'
import { EmptyState } from '../components/States.tsx'
import { homeFor } from '../lib/routes.ts'
import { useUser } from '../state/sessionContext.ts'

export default function NotFound() {
  const user = useUser()
  return (
    <EmptyState title="Page not found">
      <p>That address doesn't lead anywhere.</p>
      <Link className="btn btn-primary" to={homeFor(user)}>
        Go to your home page
      </Link>
    </EmptyState>
  )
}

import { Navigate, Outlet } from 'react-router-dom'
import type { Role } from '@contract'
import { homeFor } from '../lib/routes.ts'
import { useUser } from '../state/sessionContext.ts'

// Layout route: renders its children only for the given role, otherwise sends the user
// to their own home. This is what makes the demo role switcher land on the right page.
export default function RequireRole({ role }: { role: Role }) {
  const user = useUser()
  if (user.role !== role) return <Navigate to={homeFor(user)} replace />
  return <Outlet />
}

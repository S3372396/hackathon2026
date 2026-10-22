import { createContext, useContext } from 'react'
import type { User } from '@contract'

export interface Session {
  // null while the current user is loading (including right after a switch).
  user: User | null
  error: string | null
  // Changes whenever the session is reloaded or the demo is reset; used to remount pages.
  epoch: number
  switchUser: (id: string) => void
  reload: () => void
  // Mock API only: restores the seed data and returns to the patient's dashboard.
  resetDemo: () => Promise<void>
}

export const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (!session) throw new Error('useSession must be used inside <SessionProvider>')
  return session
}

// Pages that only render for a signed-in user.
export function useUser(): User {
  const { user } = useSession()
  if (!user) throw new Error('useUser called before the user finished loading')
  return user
}

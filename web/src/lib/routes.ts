import type { User } from '@contract'

// Where each kind of user lands after signing in or switching demo user.
export function homeFor(user: User): string {
  return user.role === 'patient' ? '/' : '/shared'
}

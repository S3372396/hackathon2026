import { DEMO_USERS } from '../demo/demoUsers.ts'
import { useSession } from '../state/sessionContext.ts'

// Demo shortcut for switching between the seeded users. Not authentication.
export default function RoleSwitcher() {
  const { user, switchUser } = useSession()

  return (
    <div className="role-switcher" role="group" aria-label="Demo user">
      <span className="role-switcher-label">Demo user</span>
      {DEMO_USERS.map((demo) => (
        <button
          key={demo.id}
          type="button"
          className="seg"
          aria-pressed={user?.id === demo.id}
          onClick={() => switchUser(demo.id)}
        >
          {demo.label}
        </button>
      ))}
    </div>
  )
}

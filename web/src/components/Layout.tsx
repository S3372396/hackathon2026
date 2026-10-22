import { NavLink, Outlet } from 'react-router-dom'
import { APP_NAME } from '../config.ts'
import { useSession } from '../state/sessionContext.ts'
import DemoBanner from './DemoBanner.tsx'
import ResetDemo from './ResetDemo.tsx'
import RoleSwitcher from './RoleSwitcher.tsx'
import { ErrorState, Loading } from './States.tsx'

const PATIENT_LINKS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/log', label: 'Log entry', end: false },
  { to: '/share', label: 'Share', end: false },
  { to: '/shares', label: 'My shares', end: false },
  { to: '/audit', label: 'Audit trail', end: false },
]

const PROFESSIONAL_LINKS = [{ to: '/shared', label: 'Shared with me', end: false }]

export default function Layout() {
  const { user, error, epoch, reload } = useSession()
  const links = user?.role === 'patient' ? PATIENT_LINKS : PROFESSIONAL_LINKS

  return (
    <div className="app">
      <DemoBanner />
      <header className="app-header">
        <div className="app-header-row">
          <span className="brand">{APP_NAME}</span>
          <div className="demo-controls">
            <RoleSwitcher />
            <ResetDemo />
          </div>
        </div>
        {user && (
          <div className="app-header-row">
            <nav className="nav" aria-label="Main">
              {links.map((link) => (
                <NavLink key={link.to} to={link.to} end={link.end}>
                  {link.label}
                </NavLink>
              ))}
            </nav>
            <span className="whoami">
              {user.name}
              {user.profession ? ` · ${user.profession}` : ' · Patient'}
            </span>
          </div>
        )}
      </header>
      {/* Keyed by user (and reset count) so no page state survives a switch or a demo reset. */}
      <main className="app-main" key={`${user?.id ?? 'loading'}:${epoch}`}>
        {error ? (
          <ErrorState title="Couldn't load your account" message={error} onRetry={reload} />
        ) : user ? (
          <Outlet />
        ) : (
          <Loading />
        )}
      </main>
      <footer className="app-footer">
        Prototype for a hackathon. Not medical advice.
      </footer>
    </div>
  )
}

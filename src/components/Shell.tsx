"use client";

import { useTideCloak } from "@tidecloak/nextjs";
import { usePathname } from "next/navigation";
import { ROLE_LABEL } from "@/lib/showgate/model";
import { useMe } from "@/lib/client";

export function Shell({ children }: { children: React.ReactNode }) {
  const { authenticated, logout, isInitializing } = useTideCloak();
  const { me } = useMe();
  const path = usePathname();
  const link = (href: string, label: string) => (
    <a href={href} className={path === href || (href !== "/" && path.startsWith(href)) ? "active" : ""}>
      {label}
    </a>
  );

  return (
    <>
      <header className="topbar">
        <div className="wrap">
          <a href="/" className="brand">
            <span className="mark">SG</span> ShowGate
          </a>
          {authenticated && (
            <nav className="nav">
              {link("/", "Shows")}
              {link("/governance", "Governance")}
            </nav>
          )}
          {authenticated && (
            <div className="who">
              <span>{me?.username}</span>
              {me?.roles.map((r) => (
                <span key={r} className="pill role">{ROLE_LABEL[r]}</span>
              ))}
              {me?.isRealmAdmin && <span className="pill lock">Realm admin</span>}
              <button className="btn ghost small" onClick={logout}>Log out</button>
            </div>
          )}
        </div>
      </header>
      <main>
        <div className="wrap">{isInitializing ? <p className="muted">Loading…</p> : children}</div>
      </main>
    </>
  );
}

export function RequireLogin({ children }: { children: React.ReactNode }) {
  const { authenticated, login } = useTideCloak();
  if (authenticated) return <>{children}</>;
  return (
    <div className="card" style={{ maxWidth: 480 }}>
      <h2>Sign in to continue</h2>
      <p className="muted">ShowGate uses Tide: no passwords stored here, and no single admin holds the keys.</p>
      <button className="btn" onClick={login}>Log in with Tide</button>
    </div>
  );
}

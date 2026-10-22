"use client";

import { useTideCloak } from "@tidecloak/nextjs";
import { useEffect, useState } from "react";
import { ROLE_LABEL } from "@/lib/showgate/model";
import { useApi, useMe, type ShowView } from "@/lib/client";

export default function HomePage() {
  const { authenticated, login } = useTideCloak();
  if (!authenticated) {
    return (
      <>
        <section className="hero">
          <div className="eyebrow">Multi-party show approval</div>
          <h1>No show goes up on one person&apos;s say-so.</h1>
          <p>
            ShowGate gathers the performance plan, its risks and the sensitive notes behind them, then holds
            the show until production, safety and venue each sign off. Tide makes that separation real: no single admin can approve the
            show, open every note, or quietly rewrite the rules.
          </p>
          <button className="btn" onClick={login}>Log in with Tide</button>
        </section>
        <div className="grid three" style={{ marginTop: 32 }}>
          <div className="card">
            <h3>Separate sign-offs</h3>
            <p className="muted">Each required role signs off on the current plan version. One person can only count for one role.</p>
          </div>
          <div className="card">
            <h3>Sealed notes per role</h3>
            <p className="muted">Notes are encrypted in the browser. The Tide network only opens a compartment for holders of its role.</p>
          </div>
          <div className="card">
            <h3>Rules under quorum</h3>
            <p className="muted">The approval rules ride in the signed login token. Changing them takes several admins, not one.</p>
          </div>
        </div>
      </>
    );
  }
  return <ShowList />;
}

function ShowList() {
  const api = useApi();
  const { me } = useMe();
  const [shows, setShows] = useState<ShowView[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ shows: ShowView[] }>("/api/shows").then((d) => setShows(d.shows), (e) => setError(e.message));
  }, [api]);

  const canSubmit = me?.roles.includes("sg-production");

  return (
    <>
      <div className="spread" style={{ marginBottom: "1rem" }}>
        <div>
          <h1>Shows</h1>
          <p className="muted">Every plan, where it stands, and who still has to sign off.</p>
        </div>
        {canSubmit && <a className="btn" href="/shows/new">Submit a show</a>}
      </div>

      {me && me.roles.length === 0 && (
        <div className="notice warn">
          You hold no ShowGate role yet, so you can see plans but cannot sign off or open any notes. A realm admin grants
          roles in the TideCloak admin console, and each grant is a change request the admins must approve.
        </div>
      )}
      {error && <div className="notice bad">{error}</div>}
      {shows && shows.length === 0 && <div className="card muted">No shows submitted yet.</div>}

      {shows && shows.length > 0 && (
        <div className="card table-scroll">
          <table>
            <thead>
              <tr><th>Show</th><th>Date</th><th>Risks</th><th>Sign-offs</th><th>Status</th></tr>
            </thead>
            <tbody>
              {shows.map((s) => (
                <tr key={s.id}>
                  <td>
                    <a href={`/shows/${s.id}`}><strong>{s.title}</strong></a>
                    <div className="muted small">{s.venue}</div>
                  </td>
                  <td>{s.performanceDate}</td>
                  <td>
                    {s.risks.filter((r) => r.level === "high").length > 0 && (
                      <span className="pill bad">{s.risks.filter((r) => r.level === "high").length} high</span>
                    )}{" "}
                    <span className="muted small">{s.risks.length} total</span>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      {s.status.counted.map((a) => <span key={a.role} className="pill ok">✓ {ROLE_LABEL[a.role]}</span>)}
                      {s.status.missingRoles.map((r) => <span key={r} className="pill">{ROLE_LABEL[r]}</span>)}
                    </div>
                  </td>
                  <td>{s.status.approved ? <span className="pill ok">Approved</span> : <span className="pill warn">Pending</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

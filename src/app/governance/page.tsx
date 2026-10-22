"use client";

import { useEffect, useState } from "react";
import { RequireLogin } from "@/components/Shell";
import { COMPARTMENT_FOR, ROLE_LABEL, STAFF_ROLES, type StaffRole } from "@/lib/showgate/model";
import {
  adminConsoleUrl,
  explainTideError,
  pendingChangeRequests,
  signCompartment,
  useApi,
  useMe,
  type ChangeRequest,
  type Me,
} from "@/lib/client";

export default function GovernancePage() {
  return (
    <RequireLogin>
      <Governance />
    </RequireLogin>
  );
}

function Governance() {
  const { me, error } = useMe();
  if (error) return <div className="notice bad">{error}</div>;
  if (!me) return <p className="muted">Loading…</p>;
  return (
    <>
      <h1>Governance</h1>
      <p className="muted">What it takes to change who can do what. Nothing on this page can be done by one admin alone.</p>
      <Rules me={me} />
      <NoUnilateral />
      <Compartments me={me} />
      {me.isRealmAdmin && <ChangeRequests />}
    </>
  );
}

function Rules({ me }: { me: Me }) {
  return (
    <div className="card">
      <div className="eyebrow">Approval rules in force</div>
      {me.rules ? (
        <>
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="pill role">v{me.rules.version}</span>
            {me.rules.requiredApprovals.map((r) => <span key={r} className="pill ok">{ROLE_LABEL[r]} sign-off</span>)}
            {me.rules.mitigationRequiredFor.map((l) => <span key={l} className="pill warn">{l} risks need mitigation</span>)}
          </div>
          <p className="small muted">
            These rules are not stored in ShowGate. They are a client mapper in TideCloak, delivered inside your login token
            and signed by the Tide network, and the server reads them from the verified token. To change them, an admin edits the
            <strong> ShowGate approval rules</strong> mapper. That files a change request, which takes effect only after the admin
            quorum approves it in the Tide enclave. Everyone picks up the new rules at their next login.
          </p>
        </>
      ) : (
        <div className="notice bad">Your token carries no showgate_rules claim. The server fails closed, so no show can be approved.</div>
      )}
    </div>
  );
}

function NoUnilateral() {
  const rows: [string, string, string][] = [
    ["Approve a show", "Every required role signs off on the same plan version, one person per role.", "Server checks the verified, DPoP-bound token"],
    ["Read sealed notes", "Hold the compartment's role. Granting a role is an IGA change request.", "Tide network (RelationshipAttestation:1)"],
    ["Change approval rules", "Edit the rules mapper, then the admin quorum approves.", "TideCloak IGA + Tide enclave signatures"],
    ["Grant yourself a role", "Same as any role grant: a quorum-approved change request.", "TideCloak IGA"],
    ["Forge a token or decrypt offline", "Not possible: keys are split across the Tide network.", "Threshold cryptography"],
  ];
  return (
    <div className="card table-scroll">
      <div className="eyebrow">What nobody can do alone</div>
      <table>
        <thead><tr><th>Action</th><th>What it takes</th><th>Enforced by</th></tr></thead>
        <tbody>{rows.map(([a, b, c]) => <tr key={a}><td><strong>{a}</strong></td><td>{b}</td><td className="muted">{c}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function Compartments({ me }: { me: Me }) {
  const api = useApi();
  const [configured, setConfigured] = useState<{ role: StaffRole; grantedBy: string; createdAt: string }[]>([]);
  const [busy, setBusy] = useState<StaffRole | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const load = () => api<{ configured: typeof configured }>("/api/policies").then((d) => setConfigured(d.configured), () => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  async function sign(role: StaffRole) {
    setBusy(role);
    setMsg(null);
    try {
      await signCompartment(api, role);
      setMsg({ kind: "ok", text: `${ROLE_LABEL[role]} compartment policy signed and stored.` });
      await load();
    } catch (e) {
      setMsg({ kind: "bad", text: explainTideError(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card">
      <div className="eyebrow">Sealed-note compartments</div>
      <p className="small muted">
        Each compartment is bound by a signed Tide policy to one role (built-in contract RelationshipAttestation:1). A realm admin
        signs each policy once in the Tide enclave. After that, the admin can&apos;t open the notes either without holding the role.
      </p>
      <div className="grid three">
        {STAFF_ROLES.map((role) => {
          const c = configured.find((x) => x.role === role);
          return (
            <div key={role} className={`lane ${c ? "signed" : ""}`}>
              <h3>{ROLE_LABEL[role]}</h3>
              <div className="mono muted">{COMPARTMENT_FOR[role]}</div>
              <div style={{ margin: "8px 0" }}>
                {c ? <span className="pill ok">Policy signed by {c.grantedBy}</span> : <span className="pill warn">Not set up</span>}
              </div>
              {me.isRealmAdmin && (
                <button className="btn small" disabled={busy !== null} onClick={() => sign(role)}>
                  {busy === role ? "Waiting for enclave…" : c ? "Re-sign policy" : "Sign policy"}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {!me.isRealmAdmin && <p className="small muted" style={{ marginTop: 8 }}>Only a tide-realm-admin can sign compartment policies.</p>}
      {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}
    </div>
  );
}

function ChangeRequests() {
  const [crs, setCrs] = useState<ChangeRequest[] | null>(null);
  const [error, setError] = useState("");
  const load = () => {
    setError("");
    pendingChangeRequests().then(setCrs, (e) => setError(String(e.message || e)));
  };
  useEffect(load, []);

  return (
    <div className="card">
      <div className="spread">
        <div>
          <div className="eyebrow">Pending change requests (IGA)</div>
          <p className="small muted">
            Role grants and rule changes wait here until enough admins approve them. Approve in the TideCloak admin console, which
            opens the Tide enclave so each approval is a real signature.
          </p>
        </div>
        <div className="row">
          <button className="btn ghost small" onClick={load}>Refresh</button>
          <a className="btn small" href={adminConsoleUrl()} target="_blank" rel="noreferrer">Open admin console</a>
        </div>
      </div>
      {error && <div className="notice bad">{error}</div>}
      {crs && crs.length === 0 && <p className="muted">Nothing pending.</p>}
      {crs && crs.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead><tr><th>What</th><th>Action</th><th>Approvals</th><th>Ready</th></tr></thead>
            <tbody>
              {crs.map((cr) => (
                <tr key={cr.id}>
                  <td>{cr.entityType ?? "-"}</td>
                  <td>{cr.actionType ?? "-"}</td>
                  <td>{cr.authCount ?? 0} / {cr.threshold ?? "?"}</td>
                  <td>{cr.readyToCommit ? <span className="pill ok">ready</span> : <span className="pill warn">needs more</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

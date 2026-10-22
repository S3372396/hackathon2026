"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { RequireLogin } from "@/components/Shell";
import { PlanForm } from "@/components/PlanForm";
import { ROLE_LABEL, STAFF_ROLES, type StaffRole } from "@/lib/showgate/model";
import { decryptNote, encryptNote, explainTideError, useApi, useMe, type Me, type ShowView } from "@/lib/client";

export default function ShowPage() {
  return (
    <RequireLogin>
      <ShowDetail />
    </RequireLogin>
  );
}

function ShowDetail() {
  const { id } = useParams<{ id: string }>();
  const api = useApi();
  const { me } = useMe();
  const [show, setShow] = useState<ShowView | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    api<{ show: ShowView }>(`/api/shows/item?id=${encodeURIComponent(id)}`).then((d) => setShow(d.show), (e) => setError(e.message));
  }, [api, id]);
  useEffect(load, [load]);

  if (error && !show) return <div className="notice bad">{error}</div>;
  if (!show || !me) return <p className="muted">Loading…</p>;

  if (editing) {
    return (
      <>
        <h1>Revise plan</h1>
        <div className="notice warn">Saving a revision creates plan v{show.planVersion + 1}. Every existing sign-off stops counting and has to be given again.</div>
        <PlanForm
          initial={show}
          rules={me.rules}
          submitLabel="Save revision"
          onSubmit={async (plan) => {
            const d = await api<{ show: ShowView }>(`/api/shows/item?id=${encodeURIComponent(id)}`, { method: "PUT", body: plan });
            setShow(d.show);
            setEditing(false);
          }}
        />
      </>
    );
  }

  return (
    <>
      <div className="spread" style={{ marginBottom: "1rem" }}>
        <div>
          <div className="eyebrow">{show.venue} · {show.performanceDate} · plan v{show.planVersion}</div>
          <h1>{show.title}</h1>
          <p className="muted small">Submitted by {show.submittedBy}</p>
        </div>
        {me.roles.includes("sg-production") && <button className="btn ghost" onClick={() => setEditing(true)}>Revise plan</button>}
      </div>

      <Marquee show={show} />

      {show.summary && (
        <div className="card">
          <div className="eyebrow">Plan summary</div>
          <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{show.summary}</p>
        </div>
      )}

      <RiskSummary show={show} me={me} />
      <Approvals show={show} me={me} onChange={setShow} />
      <Notes show={show} me={me} onChange={setShow} />
    </>
  );
}

function Marquee({ show }: { show: ShowView }) {
  if (show.status.approved) {
    return (
      <div className="marquee approved">
        <span style={{ fontSize: "2rem" }}>✓</span>
        <div>
          <h2>Approved: cleared for performance</h2>
          <div className="small">
            Signed off on plan v{show.planVersion} by {show.status.counted.map((a) => `${a.username} (${ROLE_LABEL[a.role]})`).join(", ")}.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="marquee pending">
      <span className="pill warn">Not approved</span>
      <div className="small">{show.status.blockers.join(" ")}</div>
    </div>
  );
}

function RiskSummary({ show, me }: { show: ShowView; me: Me }) {
  const required = me.rules?.mitigationRequiredFor ?? ["medium", "high"];
  const counts = { high: 0, medium: 0, low: 0 } as Record<string, number>;
  show.risks.forEach((r) => counts[r.level]++);
  return (
    <div className="card">
      <div className="spread">
        <div>
          <div className="eyebrow">Risk summary</div>
          <div className="row" style={{ marginBottom: "0.75rem" }}>
            <span className="pill bad">{counts.high} high</span>
            <span className="pill warn">{counts.medium} medium</span>
            <span className="pill">{counts.low} low</span>
          </div>
        </div>
        <span className="muted small">Mitigation mandatory for: {required.join(", ")}</span>
      </div>
      {show.risks.length === 0 ? (
        <p className="muted">No risky elements listed.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Element</th><th>Level</th><th>Mitigation</th><th>Owner</th></tr></thead>
            <tbody>
              {show.risks.map((r) => {
                const missing = required.includes(r.level) && (!r.mitigation.trim() || !r.owner.trim());
                return (
                  <tr key={r.id}>
                    <td>{r.element}</td>
                    <td><span className={`pill ${r.level === "high" ? "bad" : r.level === "medium" ? "warn" : ""}`}>{r.level}</span></td>
                    <td>{r.mitigation || (missing ? <span className="pill bad">missing: blocks sign-off</span> : <span className="muted">-</span>)}</td>
                    <td>{r.owner || (missing ? <span className="pill bad">missing</span> : <span className="muted">-</span>)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Approvals({ show, me, onChange }: { show: ShowView; me: Me; onChange: (s: ShowView) => void }) {
  const api = useApi();
  const [busy, setBusy] = useState<StaffRole | null>(null);
  const [error, setError] = useState("");
  const required = me.rules?.requiredApprovals ?? [];
  const current = show.approvals.filter((a) => a.planVersion === show.planVersion);
  const stale = show.approvals.length - current.length;

  async function act(role: StaffRole, method: "POST" | "DELETE") {
    setBusy(role);
    setError("");
    try {
      onChange((await api<{ show: ShowView }>("/api/shows/approve", { method, body: { id: show.id, role } })).show);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card">
      <div className="eyebrow">Sign-offs required by the current rules (v{me.rules?.version ?? "?"})</div>
      {!me.rules && <div className="notice bad">Your session carries no approval rules, so nothing can be signed off.</div>}
      <div className="grid three" style={{ marginTop: "0.5rem" }}>
        {required.map((role) => {
          const a = current.find((x) => x.role === role);
          const mine = me.roles.includes(role);
          return (
            <div key={role} className={`lane ${a ? "signed" : ""}`}>
              <h3>{ROLE_LABEL[role]}</h3>
              {a ? (
                <>
                  <span className="pill ok">✓ Signed off</span>
                  <p className="small muted" style={{ marginTop: 6 }}>{a.username}, {new Date(a.at).toLocaleString()}</p>
                  {mine && a.username === me.username && (
                    <button className="btn ghost small" disabled={busy === role} onClick={() => act(role, "DELETE")}>Withdraw</button>
                  )}
                </>
              ) : (
                <>
                  <span className="pill">Waiting</span>
                  <p className="small muted" style={{ marginTop: 6 }}>{mine ? "You hold this role." : `Needs someone with the ${ROLE_LABEL[role]} role.`}</p>
                  {mine && (
                    <button className="btn ok small" disabled={busy === role} onClick={() => act(role, "POST")}>
                      Sign off as {ROLE_LABEL[role]}
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      {stale > 0 && <p className="small muted" style={{ marginTop: 10 }}>{stale} earlier sign-off(s) were for an older plan version and no longer count.</p>}
      {error && <div className="notice bad">{error}</div>}
    </div>
  );
}

function Notes({ show, me, onChange }: { show: ShowView; me: Me; onChange: (s: ShowView) => void }) {
  return (
    <div className="card">
      <div className="eyebrow">Sensitive notes</div>
      <p className="muted small">
        Encrypted in your browser before upload. The server stores only ciphertext. Each compartment is bound by a Tide policy
        to one role, and the Tide network refuses to decrypt for anyone else, whatever this server says.
      </p>
      <div className="grid three">
        {STAFF_ROLES.map((role) =>
          me.roles.includes(role) ? (
            <OpenCompartment key={role} role={role} show={show} onChange={onChange} />
          ) : (
            <div key={role} className="lane">
              <h3>{ROLE_LABEL[role]} notes</h3>
              <span className="pill lock">🔒 Sealed</span>
              <p className="small muted" style={{ marginTop: 6 }}>
                {show.hiddenNotes.find((h) => h.role === role)?.count ?? 0} note(s). Only holders of the {ROLE_LABEL[role]} role can open
                this compartment. That includes admins: an admin would first need the role, and granting it takes the admin quorum.
              </p>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function OpenCompartment({ role, show, onChange }: { role: StaffRole; show: ShowView; onChange: (s: ShowView) => void }) {
  const api = useApi();
  const [text, setText] = useState("");
  const [plain, setPlain] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const notes = show.notes.filter((n) => n.role === role);

  async function add() {
    if (!text.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const ciphertext = await encryptNote(api, role, text.trim());
      onChange((await api<{ show: ShowView }>("/api/shows/notes", { method: "POST", body: { id: show.id, role, ciphertext } })).show);
      setText("");
      setMsg({ kind: "ok", text: "Encrypted and stored." });
    } catch (e) {
      setMsg({ kind: "bad", text: explainTideError(e) });
    } finally {
      setBusy(false);
    }
  }

  async function open(id: string, ciphertext: string) {
    setBusy(true);
    setMsg(null);
    try {
      const p = await decryptNote(api, role, ciphertext);
      setPlain((x) => ({ ...x, [id]: p }));
    } catch (e) {
      setMsg({ kind: "bad", text: explainTideError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lane">
      <h3>{ROLE_LABEL[role]} notes</h3>
      <span className="pill ok">Your compartment</span>
      {notes.map((n) => (
        <div key={n.id} style={{ marginTop: 10, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
          <div className="small muted">{n.author}, {new Date(n.createdAt).toLocaleString()}</div>
          {plain[n.id] ? (
            <p style={{ whiteSpace: "pre-wrap", margin: "4px 0" }}>{plain[n.id]}</p>
          ) : (
            <>
              <div className="mono muted" style={{ margin: "4px 0" }}>{n.ciphertext.slice(0, 64)}…</div>
              <button className="btn ghost small" disabled={busy} onClick={() => open(n.id, n.ciphertext)}>Decrypt</button>
            </>
          )}
        </div>
      ))}
      <div className="field" style={{ marginTop: 12 }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={`Add a sealed ${ROLE_LABEL[role].toLowerCase()} note…`} />
      </div>
      <button className="btn small" disabled={busy || !text.trim()} onClick={add}>{busy ? "Working…" : "Encrypt & add"}</button>
      {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}
    </div>
  );
}

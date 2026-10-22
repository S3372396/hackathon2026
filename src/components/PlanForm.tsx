"use client";

import { useState } from "react";
import { RISK_LEVELS, type ApprovalRules, type Risk, type RiskLevel, type Show } from "@/lib/showgate/model";

type Plan = Pick<Show, "title" | "venue" | "performanceDate" | "summary" | "risks">;

const blankRisk = (): Risk => ({ id: crypto.randomUUID(), element: "", level: "medium", mitigation: "", owner: "" });

export function PlanForm({
  initial,
  rules,
  submitLabel,
  onSubmit,
}: {
  initial?: Plan;
  rules: ApprovalRules | null;
  submitLabel: string;
  onSubmit: (plan: Plan) => Promise<void>;
}) {
  const [plan, setPlan] = useState<Plan>(
    initial ?? { title: "", venue: "", performanceDate: "", summary: "", risks: [blankRisk()] },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mandatory = (l: RiskLevel) => rules?.mitigationRequiredFor.includes(l) ?? l !== "low";
  const set = <K extends keyof Plan>(k: K, v: Plan[K]) => setPlan((p) => ({ ...p, [k]: v }));
  const setRisk = (i: number, patch: Partial<Risk>) =>
    set("risks", plan.risks.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const open = plan.risks.filter((r) => r.element.trim() && mandatory(r.level) && (!r.mitigation.trim() || !r.owner.trim()));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit({ ...plan, risks: plan.risks.filter((r) => r.element.trim()) });
    } catch (err) {
      setError(String((err as Error).message || err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="card">
        <div className="eyebrow">Performance plan</div>
        <div className="grid two">
          <div className="field">
            <label htmlFor="title">Production title</label>
            <input id="title" required value={plan.title} onChange={(e) => set("title", e.target.value)} placeholder="The Tempest — opening night" />
          </div>
          <div className="field">
            <label htmlFor="venue">Venue</label>
            <input id="venue" required value={plan.venue} onChange={(e) => set("venue", e.target.value)} placeholder="Lyric Hall, main stage" />
          </div>
          <div className="field">
            <label htmlFor="date">Performance date</label>
            <input id="date" type="date" required value={plan.performanceDate} onChange={(e) => set("performanceDate", e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="summary">Plan summary</label>
          <textarea id="summary" value={plan.summary} onChange={(e) => set("summary", e.target.value)} placeholder="Running order, cast and crew numbers, technical cues, audience capacity…" />
        </div>
      </div>

      <div className="card">
        <div className="spread">
          <div>
            <div className="eyebrow">Risky elements</div>
            <p className="muted small">
              Mitigation and an owner are mandatory for {rules ? rules.mitigationRequiredFor.join(" and ") : "medium and high"} risks.
              Nobody can sign off while one is missing.
            </p>
          </div>
          <button type="button" className="btn ghost small" onClick={() => set("risks", [...plan.risks, blankRisk()])}>+ Add risk</button>
        </div>
        {plan.risks.map((r, i) => {
          const missing = r.element.trim() && mandatory(r.level) && (!r.mitigation.trim() || !r.owner.trim());
          return (
            <div key={r.id} className="lane" style={{ marginBottom: "0.75rem", borderColor: missing ? "var(--warn)" : undefined }}>
              <div className="grid two">
                <div className="field">
                  <label>Element</label>
                  <input value={r.element} onChange={(e) => setRisk(i, { element: e.target.value })} placeholder="Flash pots, Act 2 storm" />
                </div>
                <div className="field">
                  <label>Level</label>
                  <select value={r.level} onChange={(e) => setRisk(i, { level: e.target.value as RiskLevel })}>
                    {RISK_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Mitigation {mandatory(r.level) && <span className="pill warn">mandatory</span>}</label>
                <textarea value={r.mitigation} onChange={(e) => setRisk(i, { mitigation: e.target.value })} placeholder="Licensed pyro tech on cue, 3m exclusion zone, extinguisher stage left" />
              </div>
              <div className="spread">
                <div className="field" style={{ flex: 1, minWidth: 200 }}>
                  <label>Owner</label>
                  <input value={r.owner} onChange={(e) => setRisk(i, { owner: e.target.value })} placeholder="Deputy stage manager" />
                </div>
                <button type="button" className="btn ghost small" style={{ marginTop: "1.6rem" }} onClick={() => set("risks", plan.risks.filter((_, j) => j !== i))}>Remove</button>
              </div>
            </div>
          );
        })}
      </div>

      {open.length > 0 && (
        <div className="notice warn">
          {open.length} risk(s) still need a mitigation and an owner. You can submit, but sign-off stays blocked until they are filled in.
        </div>
      )}
      {error && <div className="notice bad">{error}</div>}
      <button className="btn" disabled={busy}>{busy ? "Saving…" : submitLabel}</button>
    </form>
  );
}

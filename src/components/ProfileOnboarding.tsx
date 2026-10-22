"use client";

/**
 * Post-signup display name for ShowGate.
 *
 * Tide asserts only a username (the vuid), so a new user has no name. Without this, sign-offs and
 * notes would be credited to a 64-hex id. Adapted from the Tide pack's onboarding modal:
 *
 *  - Writes through the ACCOUNT API as the user themselves, never the Admin API (an admin write on
 *    this IGA realm would just queue a change request).
 *  - Uses secureFetch: this realm's tokens are DPoP-bound, so the pack's plain `Bearer` call would be
 *    rejected. secureFetch attaches `DPoP <token>` and a proof for the TideCloak URL.
 *  - Dismissible, and asks only for what ShowGate shows. Keycloak has no displayName attribute, so
 *    the name is stored as firstName and arrives as the `given_name` claim.
 */

import { useEffect, useState } from "react";
import { useTideCloak } from "@tidecloak/nextjs";

const DISMISS_KEY = "showgate.profile-onboarding.dismissed";

export function ProfileOnboarding({ baseUrl, realm }: { baseUrl: string; realm: string }) {
  const { authenticated, getValueFromToken, secureFetch, forceRefreshToken } = useTideCloak();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authenticated) return;
    try {
      if (localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      // storage blocked: just ask
    }
    if (!getValueFromToken("given_name")) setOpen(true);
  }, [authenticated, getValueFromToken]);

  if (!open) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {}
    setOpen(false);
  };

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await secureFetch(`${baseUrl.replace(/\/+$/, "")}/realms/${realm}/account/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: name.trim() }),
      });
      if (res.status === 401 || res.status === 403) {
        throw new Error("Not authorised to update your profile (check the token has the `account` audience).");
      }
      if (res.status === 202) {
        throw new Error("Your name was queued for admin approval and is not saved yet.");
      }
      if (!res.ok) throw new Error(`Could not save your name (${res.status}).`);
      // Pick up the new given_name claim now rather than at the next login.
      await forceRefreshToken().catch(() => false);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", background: "rgba(0,0,0,.45)", zIndex: 1000, padding: "1rem" }}
    >
      <div className="card" style={{ width: "min(28rem, 100%)", margin: 0 }}>
        <div className="eyebrow">Welcome to ShowGate</div>
        <h2 id="onboarding-title">What should the crew call you?</h2>
        <p className="muted small">Shown on your sign-offs and notes. Optional: you can skip this.</p>
        <div className="field">
          <label htmlFor="onboarding-name">Display name</label>
          <input id="onboarding-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sam (Safety officer)" autoComplete="given-name" />
        </div>
        {error && <div className="notice bad" role="alert">{error}</div>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn ghost" onClick={dismiss} disabled={busy}>Not now</button>
          <button type="button" className="btn" onClick={save} disabled={busy || !name.trim()}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

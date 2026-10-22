"use client";

import { useTideCloak } from "@tidecloak/nextjs";
import { AdminAPI } from "@tidecloak/js";
import { useCallback, useEffect, useState } from "react";
import type { ApprovalRules, Show, StaffRole } from "@/lib/showgate/model";
import { COMPARTMENT_FOR } from "@/lib/showgate/model";
import { decryptForRecord, encryptForRecord, signRelationshipPolicy } from "@/lib/tide/relationship";
import tcConfig from "../../data/tidecloak.json";

export interface Me {
  username: string;
  roles: StaffRole[];
  isRealmAdmin: boolean;
  rules: ApprovalRules | null;
}

export type ShowView = Show & {
  hiddenNotes: { role: StaffRole; count: number }[];
  status: { approved: boolean; counted: Show["approvals"]; missingRoles: StaffRole[]; blockers: string[] };
};

/**
 * Calls our own API through secureFetch. With no Authorization header set, secureFetch attaches
 * `Authorization: DPoP <token>` plus a fresh DPoP proof, which is what the server's withAuth
 * verifies. A plain fetch with `Bearer` is rejected as a replay.
 */
export function useApi() {
  const { secureFetch } = useTideCloak();
  return useCallback(
    async <T,>(path: string, init?: { method?: string; body?: unknown }): Promise<T> => {
      const res = await secureFetch(path, {
        method: init?.method ?? "GET",
        headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
      return data as T;
    },
    [secureFetch],
  );
}

export function useMe() {
  const { authenticated } = useTideCloak();
  const api = useApi();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!authenticated) return;
    api<Me>("/api/me").then(setMe, (e) => setError(String(e.message || e)));
  }, [authenticated, api]);
  return { me, error };
}

// --- sensitive notes -----------------------------------------------------------------------

async function policyFor(api: ReturnType<typeof useApi>, role: StaffRole): Promise<string> {
  const { policies } = await api<{ policies: { role: StaffRole; policy: string }[] }>("/api/policies");
  const p = policies.find((x) => x.role === role);
  if (!p) throw new Error("This compartment has not been set up yet. A realm admin signs its policy on the Governance page.");
  return p.policy;
}

export async function encryptNote(api: ReturnType<typeof useApi>, role: StaffRole, text: string) {
  return encryptForRecord(text, COMPARTMENT_FOR[role], await policyFor(api, role));
}

export async function decryptNote(api: ReturnType<typeof useApi>, role: StaffRole, ciphertext: string) {
  return decryptForRecord(ciphertext, COMPARTMENT_FOR[role], await policyFor(api, role));
}

/**
 * A contract refusal arrives as "Could not reach enough VVK ORKs". It is a "no", not an outage:
 * every ORK answered and refused (AP-RA18). Say so instead of suggesting a retry.
 */
export function explainTideError(e: unknown): string {
  const err = e as { message?: string; cause?: unknown };
  const text = `${err?.message ?? e} ${err?.cause ? String((err.cause as { message?: string }).message ?? err.cause) : ""}`;
  if (/not found in doken|subjectId does not match|not found in list of roles|role not found for this/i.test(text) ||
      /Could not reach enough VVK ORKs/i.test(text)) {
    return "The Tide network refused: your role does not open this compartment. " + text.trim();
  }
  if (/Popup/i.test(text)) return "The Tide enclave pop-up was blocked. Allow pop-ups for this site and try again.";
  return text.trim();
}

// --- realm admin: compartment policies and governance --------------------------------------

const realm = (tcConfig as { realm: string }).realm;
const vendorId = (tcConfig as { vendorId?: string }).vendorId ?? "";

/**
 * Fetches the realm's admin policy straight from TideCloak in the admin's browser. AdminAPI goes
 * through secureFetch, so the DPoP-bound admin token never passes through our server.
 */
async function adminPolicyBytes(): Promise<Uint8Array> {
  const res = (await AdminAPI.fetch(`/admin/realms/${realm}/iga/role-policies/name/tide-realm-admin`)) as { policy?: string };
  if (!res?.policy) throw new Error("The realm has no signed admin policy yet (is tide-realm-admin granted?).");
  return Uint8Array.from(atob(res.policy), (c) => c.charCodeAt(0));
}

/** Opens the Tide enclave: the admin's approval IS the grant of the compartment to the role. */
export async function signCompartment(api: ReturnType<typeof useApi>, role: StaffRole) {
  if (!vendorId) throw new Error("data/tidecloak.json has no vendorId. Re-run npm run init.");
  const policy = await signRelationshipPolicy(
    { vendorId, subject: { type: "Role", id: role }, recordId: COMPARTMENT_FOR[role], access: "read-write" },
    await adminPolicyBytes(),
  );
  await api("/api/policies", { method: "POST", body: { role, compartment: COMPARTMENT_FOR[role], policy } });
}

export interface ChangeRequest {
  id: string;
  entityType?: string;
  actionType?: string;
  status?: string;
  authCount?: number;
  threshold?: number;
  readyToCommit?: boolean;
  createdBy?: string;
  [k: string]: unknown;
}

export async function pendingChangeRequests(): Promise<ChangeRequest[]> {
  const data = (await AdminAPI.fetch(`/admin/realms/${realm}/iga/change-requests?status=PENDING`)) as unknown;
  if (Array.isArray(data)) return data as ChangeRequest[];
  if (data && typeof data === "object") return Object.values(data as Record<string, ChangeRequest>);
  return [];
}

export const adminConsoleUrl = () =>
  `${String((tcConfig as Record<string, unknown>)["auth-server-url"] ?? "").replace(/\/+$/, "")}/admin/${realm}/console/`;

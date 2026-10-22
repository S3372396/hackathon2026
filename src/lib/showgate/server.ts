import type { JWTPayload } from "jose";
import { hasRole } from "@/lib/auth/tideJWT";
import { STAFF_ROLES, parseRules, showStatus, type Show, type StaffRole } from "./model";

// Everything here reads the VERIFIED token handed over by withAuth. Nothing trusts the request body
// for who the caller is or what the rules are.

export function staffRolesOf(jwt: JWTPayload): StaffRole[] {
  return STAFF_ROLES.filter((r) => hasRole(jwt, r));
}

export function rulesOf(jwt: JWTPayload) {
  return parseRules((jwt as Record<string, unknown>).showgate_rules);
}

export function isRealmAdmin(jwt: JWTPayload): boolean {
  const ra = (jwt.resource_access as Record<string, { roles?: string[] }> | undefined)?.["realm-management"];
  return !!ra?.roles?.includes("tide-realm-admin");
}

// The display name a user set in the onboarding form arrives as given_name; until then all we have
// is the Tide vuid, which is shortened so it stays readable.
export function username(jwt: JWTPayload): string {
  const c = jwt as Record<string, unknown>;
  if (typeof c.given_name === "string" && c.given_name.trim()) return c.given_name.trim();
  const id = String(c.preferred_username ?? jwt.sub ?? "unknown");
  return id.length > 16 ? `${id.slice(0, 8)}…` : id;
}

/** What the caller may see of a show: ciphertext only for compartments their roles cover. */
export function viewFor(show: Show, jwt: JWTPayload) {
  const mine = staffRolesOf(jwt);
  const rules = rulesOf(jwt);
  return {
    ...show,
    notes: show.notes.filter((n) => mine.includes(n.role)),
    hiddenNotes: STAFF_ROLES.filter((r) => !mine.includes(r)).map((role) => ({
      role,
      count: show.notes.filter((n) => n.role === role).length,
    })),
    status: showStatus(show, rules),
  };
}

export const bad = (error: string, status = 400) => Response.json({ error }, { status });

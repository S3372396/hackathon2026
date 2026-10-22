import { withAuth } from "@/lib/auth/middleware";
import { COMPARTMENT_FOR, STAFF_ROLES } from "@/lib/showgate/model";
import { bad, isRealmAdmin, staffRolesOf, username } from "@/lib/showgate/server";
import { policies } from "@/lib/showgate/store";

// GET /api/policies — the signed compartment policies that apply to the caller (one per staff
// role they hold), plus which compartments are set up at all. A policy names a role, not a person,
// but handing it only to holders keeps "who can open what" from leaking (AP-RA07).
export const GET = withAuth(async (_req, jwt) => {
  const mine = staffRolesOf(jwt);
  const all = policies.all();
  return Response.json({
    configured: all.map((p) => ({ role: p.role, grantedBy: p.grantedBy, createdAt: p.createdAt })),
    policies: all.filter((p) => mine.includes(p.role)).map((p) => ({ role: p.role, compartment: p.compartment, policy: p.policy })),
  });
});

// POST /api/policies { role, compartment, policy } — store a policy a realm admin just signed in
// the Tide enclave. Admins only (AP-RA08). The network rejects anything not signed by the realm,
// so a forged blob here can only break access, never grant it.
export const POST = withAuth(async (req, jwt) => {
  if (!isRealmAdmin(jwt)) return bad("Only a tide-realm-admin can store compartment policies.", 403);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const role = STAFF_ROLES.find((r) => r === body?.role);
  if (!role) return bad("Unknown role");
  if (body?.compartment !== COMPARTMENT_FOR[role]) return bad("Compartment does not match role");
  const policy = body?.policy;
  if (typeof policy !== "string" || !/^[A-Za-z0-9+/]+=*$/.test(policy) || policy.length > 100_000) return bad("Policy must be base64");

  policies.save({ role, compartment: COMPARTMENT_FOR[role], policy, grantedBy: username(jwt), createdAt: new Date().toISOString() });
  return Response.json({ ok: true }, { status: 201 });
});

import { withAuth } from "@/lib/auth/middleware";
import { ROLE_LABEL, STAFF_ROLES, unmitigatedRisks, type StaffRole } from "@/lib/showgate/model";
import { bad, rulesOf, staffRolesOf, username, viewFor } from "@/lib/showgate/server";
import { shows } from "@/lib/showgate/store";

// POST /api/shows/approve  { id, role } — sign off for one role.
// DELETE /api/shows/approve { id, role } — withdraw your own sign-off.
//
// Enforced here from the verified token: you hold the role, the role is one the signed rules
// require, and one person counts for one role only. Nobody, admin included, approves alone.
export const POST = withAuth(async (req, jwt) => {
  const { show, role, error } = await target(req);
  if (error) return error;

  const rules = rulesOf(jwt);
  if (!rules) return bad("Your session carries no approval rules, so nothing can be approved.", 403);
  if (!staffRolesOf(jwt).includes(role)) return bad(`You do not hold the ${ROLE_LABEL[role]} role.`, 403);
  if (!rules.requiredApprovals.includes(role)) return bad(`${ROLE_LABEL[role]} sign-off is not required by the current rules.`, 409);

  const current = show.approvals.filter((a) => a.planVersion === show.planVersion);
  if (current.some((a) => a.role === role)) return bad(`${ROLE_LABEL[role]} has already signed off this version.`, 409);
  if (current.some((a) => a.userId === jwt.sub)) {
    return bad("You already signed off this plan under another role. Separation of duties: one person, one sign-off.", 409);
  }
  const open = unmitigatedRisks(show, rules);
  if (open.length) return bad(`Cannot sign off: ${open.length} risk(s) still need a mitigation and an owner.`, 409);

  show.approvals.push({
    role,
    userId: jwt.sub!,
    username: username(jwt),
    at: new Date().toISOString(),
    planVersion: show.planVersion,
    rulesVersion: rules.version,
  });
  shows.save(show);
  return Response.json({ show: viewFor(show, jwt) });
});

export const DELETE = withAuth(async (req, jwt) => {
  const { show, role, error } = await target(req);
  if (error) return error;
  const before = show.approvals.length;
  show.approvals = show.approvals.filter(
    (a) => !(a.role === role && a.userId === jwt.sub && a.planVersion === show.planVersion),
  );
  if (show.approvals.length === before) return bad("No sign-off of yours to withdraw.", 404);
  shows.save(show);
  return Response.json({ show: viewFor(show, jwt) });
});

async function target(req: Request) {
  const body = (await req.json().catch(() => null)) as { id?: unknown; role?: unknown } | null;
  const show = shows.get(typeof body?.id === "string" ? body.id : "");
  const role = STAFF_ROLES.find((r) => r === body?.role) as StaffRole;
  if (!show) return { show: show!, role, error: bad("Show not found", 404) };
  if (!role) return { show, role, error: bad("Unknown role") };
  return { show, role, error: null };
}

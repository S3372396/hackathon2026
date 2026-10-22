import { randomUUID } from "crypto";
import { withAuth } from "@/lib/auth/middleware";
import { ROLE_LABEL, STAFF_ROLES } from "@/lib/showgate/model";
import { bad, staffRolesOf, username, viewFor } from "@/lib/showgate/server";
import { shows } from "@/lib/showgate/store";

// POST /api/shows/notes  { id, role, ciphertext } — store a note encrypted in the browser.
// The server never sees plaintext and cannot decrypt: the Tide network only releases a note to
// holders of the compartment's role. The role check here just keeps the API honest too.
export const POST = withAuth(async (req, jwt) => {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const show = shows.get(typeof body?.id === "string" ? body.id : "");
  if (!show) return bad("Show not found", 404);
  const role = STAFF_ROLES.find((r) => r === body?.role);
  if (!role) return bad("Unknown compartment");
  if (!staffRolesOf(jwt).includes(role)) return bad(`Only ${ROLE_LABEL[role]} can add ${ROLE_LABEL[role]} notes.`, 403);
  const ciphertext = body?.ciphertext;
  if (typeof ciphertext !== "string" || !ciphertext || ciphertext.length > 200_000) return bad("Missing ciphertext");

  show.notes.push({ id: randomUUID(), role, ciphertext, author: username(jwt), createdAt: new Date().toISOString() });
  show.updatedAt = new Date().toISOString();
  shows.save(show);
  return Response.json({ show: viewFor(show, jwt) }, { status: 201 });
});

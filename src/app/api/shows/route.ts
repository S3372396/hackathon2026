import { randomUUID } from "crypto";
import { withAuth, withRole } from "@/lib/auth/middleware";
import type { Show } from "@/lib/showgate/model";
import { parsePlan } from "@/lib/showgate/plan";
import { bad, username, viewFor } from "@/lib/showgate/server";
import { shows } from "@/lib/showgate/store";

// GET /api/shows — every show, with the caller's view of notes and the computed status.
export const GET = withAuth(async (_req, jwt) => {
  return Response.json({ shows: shows.all().map((s) => viewFor(s, jwt)) });
});

// POST /api/shows — submit a performance plan. Production leads only.
export const POST = withRole("sg-production", async (req, jwt) => {
  const parsed = parsePlan(await req.json().catch(() => null));
  if (typeof parsed === "string") return bad(parsed);

  const now = new Date().toISOString();
  const show: Show = {
    id: randomUUID(),
    ...parsed,
    notes: [],
    approvals: [],
    planVersion: 1,
    submittedBy: username(jwt),
    createdAt: now,
    updatedAt: now,
  };
  shows.save(show);
  return Response.json({ show: viewFor(show, jwt) }, { status: 201 });
});

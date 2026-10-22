import { withAuth, withRole } from "@/lib/auth/middleware";
import { bad, viewFor } from "@/lib/showgate/server";
import { shows } from "@/lib/showgate/store";
import { parsePlan } from "@/lib/showgate/plan";

// GET /api/shows/item?id=<showId>
export const GET = withAuth(async (req, jwt) => {
  const show = shows.get(new URL(req.url).searchParams.get("id") ?? "");
  if (!show) return bad("Show not found", 404);
  return Response.json({ show: viewFor(show, jwt) });
});

// PUT /api/shows/item?id=<showId> — revise the plan. Bumping planVersion means every existing
// approval stops counting: nobody can get a plan signed off and then quietly change it.
export const PUT = withRole("sg-production", async (req, jwt) => {
  const show = shows.get(new URL(req.url).searchParams.get("id") ?? "");
  if (!show) return bad("Show not found", 404);
  const parsed = parsePlan(await req.json().catch(() => null));
  if (typeof parsed === "string") return bad(parsed);

  const updated = { ...show, ...parsed, planVersion: show.planVersion + 1, updatedAt: new Date().toISOString() };
  shows.save(updated);
  return Response.json({ show: viewFor(updated, jwt) });
});

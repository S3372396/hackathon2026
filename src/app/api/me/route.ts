import { withAuth } from "@/lib/auth/middleware";
import { isRealmAdmin, rulesOf, staffRolesOf, username } from "@/lib/showgate/server";

// GET /api/me — who the server thinks you are, read from the verified token only.
export const GET = withAuth(async (_req, jwt) => {
  return Response.json({
    username: username(jwt),
    roles: staffRolesOf(jwt),
    isRealmAdmin: isRealmAdmin(jwt),
    rules: rulesOf(jwt),
  });
});

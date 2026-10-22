#!/bin/bash
# tidecloak/setup.sh — Stage 0 realm setup for the show-approval prototype.
#
# Adapted from the Tide agent pack's templates/shared/bootstrap-tidecloak.sh, split into two phases
# so the first login can be tested before every demo user is enrolled:
#
#   bash tidecloak/setup.sh phase1
#       Starts TideCloak (docker compose), creates the realm, roles and client, licenses it, turns on
#       IGA in Tide mode, creates admin.a and prints its invite link, waits for it to be linked.
#       Stops BEFORE the firstAdmin -> multiAdmin flip, so phase2 can still approve changes itself.
#
#   bash tidecloak/setup.sh phase2
#       Creates admin.b, admin.c, pat.production, sam.safety, val.venue and prints their invite
#       links, waits until ALL are linked (a role granted to an unlinked user stays an unsignable
#       draft, pack T-22), grants the workspace roles, then grants tide-realm-admin to admin.a
#       LAST (the one-way flip to multiAdmin) and exports ./tidecloak.json.
#
# After phase2, every admin change is a change request approved in the Tide enclave. admin.b and
# admin.c are made realm admins by admin.a in the TideCloak admin console (docs/tidecloak-setup.md).
#
# Needs: docker (Docker Desktop), curl, jq, Git Bash on Windows. Reads .env (gitignored).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TIDECLOAK_URL="${TIDECLOAK_URL:-http://localhost:8080}"
REALM_NAME="${REALM_NAME:-show-approval}"
CLIENT_NAME="${CLIENT_NAME:-show-approval-web}"
CLIENT_APP_URL="${CLIENT_APP_URL:-http://localhost:3000}"
ADAPTER_OUTPUT="${ADAPTER_OUTPUT:-./tidecloak.json}"
LINKS_FILE="./tidecloak/invite-links.txt"   # gitignored: invite links are bearer credentials

FIRST_ADMIN="admin.a"
# username -> workspace realm role ("" = none). Realm admins hold no workspace or decrypt roles.
declare -A WORKSPACE_ROLE=(
  [admin.b]=""
  [admin.c]=""
  [pat.production]="production_manager"
  [sam.safety]="safety_officer"
  [val.venue]="venue_manager"
)
PHASE2_USERS=(admin.b admin.c pat.production sam.safety val.venue)

# --- Credentials and licence answers: from .env, never hardcoded (pack AP-41, AP-90) ---
if [ -f .env ]; then set -a; . ./.env; set +a; fi
KC_BOOTSTRAP_ADMIN_USERNAME="${KC_BOOTSTRAP_ADMIN_USERNAME:-admin}"
: "${KC_BOOTSTRAP_ADMIN_PASSWORD:?KC_BOOTSTRAP_ADMIN_PASSWORD is not set (copy .env.example to .env)}"
LICENSE_EMAIL="${TIDE_LICENSE_EMAIL:-}"
if [[ ! "$LICENSE_EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || [ "${TIDE_TERMS_ACCEPTED:-}" != "yes" ]; then
  echo "STOP: TIDE_LICENSE_EMAIL and TIDE_TERMS_ACCEPTED=yes must be set in .env by the person who" >&2
  echo "      owns this deployment, after reading https://tide.org/legal. Nothing was created." >&2
  exit 2
fi

command -v jq >/dev/null || { echo "ERROR: jq is required." >&2; exit 1; }
command -v docker >/dev/null || { echo "ERROR: docker is required (start Docker Desktop)." >&2; exit 1; }

# --- Helpers ---
get_token() {
  curl -s -X POST "$TIDECLOAK_URL/realms/master/protocol/openid-connect/token" \
    --data-urlencode "username=$KC_BOOTSTRAP_ADMIN_USERNAME" \
    --data-urlencode "password=$KC_BOOTSTRAP_ADMIN_PASSWORD" \
    -d "grant_type=password&client_id=admin-cli" | jq -r '.access_token'
}

api() { # api METHOD PATH [JSON]
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -s -X "$method" "$TIDECLOAK_URL$path" -H "Authorization: Bearer $(get_token)" \
      -H "Content-Type: application/json" -d "$body"
  else
    curl -s -X "$method" "$TIDECLOAK_URL$path" -H "Authorization: Bearer $(get_token)"
  fi
}

# Authorize + commit every pending change request. Works only while the realm is firstAdmin:
# authorize signs server-side then. After the flip this is a no-op (pack T-18, AP-HOST-5).
approve_all_pending() {
  local ids id ready pass
  sleep 2
  ids=$(api GET "/admin/realms/$REALM_NAME/iga/change-requests?status=PENDING" \
    | jq -r 'if type=="array" then (.[] | select(.actionType | IN("DISABLE_IGA","DELETE_REALM","OFFBOARD_REALM") | not) | .id) else empty end')
  for id in $ids; do
    api POST "/admin/realms/$REALM_NAME/iga/change-requests/$id/authorize" '{}' >/dev/null || true
  done
  for pass in 1 2 3 4 5; do
    ready=$(api GET "/admin/realms/$REALM_NAME/iga/change-requests?status=PENDING" \
      | jq -r 'if type=="array" then (.[] | select(.actionType | IN("DISABLE_IGA","DELETE_REALM","OFFBOARD_REALM") | not) | select(.readyToCommit==true) | .id) else empty end')
    [ -z "$ready" ] && break
    for id in $ready; do api POST "/admin/realms/$REALM_NAME/iga/change-requests/$id/commit" >/dev/null || true; done
  done
}

user_id() { api GET "/admin/realms/$REALM_NAME/users?username=$1&exact=true" | jq -r '.[0].id // empty'; }
user_linked() { api GET "/admin/realms/$REALM_NAME/users?username=$1&exact=true" | jq -r '.[0].attributes.tideUserKey[0] // empty'; }

create_user() { # create_user USERNAME [EMAIL]
  local u="$1" email="${2:-}" body
  body=$(jq -n --arg u "$u" --arg e "$email" \
    '{username:$u, enabled:true, emailVerified:false, attributes:{tideInvitable:["true"]}} + (if $e=="" then {} else {email:$e} end)')
  api POST "/admin/realms/$REALM_NAME/users" "$body" >/dev/null
}

invite_link() {
  api POST "/admin/realms/$REALM_NAME/tideAdminResources/get-required-action-link?userId=$1&lifespan=43200" \
    '["link-tide-account-action"]'
}

wait_linked() { # wait_linked USER...
  local u pending
  echo "==> Waiting for account linking (polling every 5s; Ctrl+C is safe, re-run the same phase)..."
  while true; do
    pending=""
    for u in "$@"; do [ -n "$(user_linked "$u")" ] || pending="$pending $u"; done
    [ -z "$pending" ] && { echo "  All linked: $*"; return; }
    echo "  still waiting for:$pending"
    sleep 5
  done
}

realm_exists() { [ "$(curl -s -o /dev/null -w '%{http_code}' "$TIDECLOAK_URL/realms/$REALM_NAME")" = "200" ]; }

# ============================================================================================
phase1() {
  if realm_exists; then
    echo "Realm '$REALM_NAME' already exists. To start over: docker compose down && rm -rf tidecloak/data" >&2
    exit 1
  fi

  echo "==> Starting TideCloak (docker compose)..."
  mkdir -p tidecloak/data
  docker compose up -d
  for i in $(seq 1 40); do curl -sf "$TIDECLOAK_URL/realms/master" >/dev/null 2>&1 && break; sleep 3; done
  curl -sf "$TIDECLOAK_URL/realms/master" >/dev/null || { echo "ERROR: TideCloak did not start. docker compose logs tidecloak" >&2; exit 1; }

  echo "==> Creating realm '$REALM_NAME' (roles + client '$CLIENT_NAME')..."
  sed -e "s|REALM_NAME|$REALM_NAME|g" -e "s|CLIENT_NAME|$CLIENT_NAME|g" -e "s|CLIENT_APP_URL|$CLIENT_APP_URL|g" \
    tidecloak/realm.json.template > tidecloak/.realm.json
  api POST "/admin/realms" "$(cat tidecloak/.realm.json)"
  rm -f tidecloak/.realm.json
  realm_exists || { echo "ERROR: realm was not created." >&2; exit 1; }

  # Before IGA: afterwards this is a governed write. Stops Keycloak's "Update Account Information"
  # page for every new Tide user (pack Step 3b).
  echo "==> Disabling the first-broker-login profile page..."
  local exec cfg
  exec=$(api GET "/admin/realms/$REALM_NAME/authentication/flows/first%20broker%20login/executions")
  cfg=$(printf '%s' "$exec" | jq -r '.[]? | select(.providerId=="idp-review-profile") | .authenticationConfig // empty' | head -1)
  [ -n "$cfg" ] && api PUT "/admin/realms/$REALM_NAME/authentication/config/$cfg" \
    '{"alias":"review profile config","config":{"update.profile.on.first.login":"off"}}' >/dev/null

  echo "==> Licensing the realm with Tide (setUpTideRealm)..."
  local out
  out=$(curl -s -w '\n%{http_code}' -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/vendorResources/setUpTideRealm" \
    -H "Authorization: Bearer $(get_token)" \
    --data-urlencode "email=$LICENSE_EMAIL" --data-urlencode "isRagnarokEnabled=true")
  case "$(printf '%s' "$out" | tail -1)" in 2??) ;; *) echo "ERROR: setUpTideRealm failed: $out" >&2; exit 1 ;; esac
  case "$out" in *NEED_PAYMENT*) echo "ERROR: realm is NOT licensed (NEED_PAYMENT)." >&2; exit 1 ;; esac

  echo "==> Enabling IGA in Tide mode (quorum-enforced admin changes)..."
  api PUT "/admin/realms/$REALM_NAME" \
    "$(api GET "/admin/realms/$REALM_NAME" | jq '.attributes = ((.attributes // {}) + {"iga.attestor":"tide"})')" >/dev/null
  out=$(curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/tide-admin/toggle-iga" \
    -H "Authorization: Bearer $(get_token)" --data-urlencode "isIGAEnabled=true")
  case "$out" in *'"enabled":true'*) ;; *) echo "ERROR: toggle-iga did not enable IGA: $out" >&2; exit 1 ;; esac
  approve_all_pending

  echo "==> Creating $FIRST_ADMIN..."
  create_user "$FIRST_ADMIN" "$LICENSE_EMAIL"
  approve_all_pending
  local uid
  uid=$(user_id "$FIRST_ADMIN")
  [ -n "$uid" ] || { echo "ERROR: $FIRST_ADMIN was not created." >&2; exit 1; }

  local link
  link=$(invite_link "$uid")
  printf '%s %s\n' "$FIRST_ADMIN" "$link" > "$LINKS_FILE"
  echo ""
  echo "================ INVITE LINK: $FIRST_ADMIN ================"
  echo "$link"
  echo "==========================================================="
  wait_linked "$FIRST_ADMIN"
  approve_all_pending

  # Point the Tide IdP at this realm's console and sign the IdP settings (pack Step 10, firstAdmin).
  echo "==> Signing IdP settings..."
  local inst
  inst=$(api GET "/admin/realms/$REALM_NAME/identity-provider/instances/tide")
  api PUT "/admin/realms/$REALM_NAME/identity-provider/instances/tide" \
    "$(printf '%s' "$inst" | jq --arg d "$TIDECLOAK_URL/realms/$REALM_NAME/tide-console/" '.config.CustomAdminUIDomain=$d')" >/dev/null
  api POST "/admin/realms/$REALM_NAME/vendorResources/sign-idp-settings" >/dev/null

  echo ""
  echo "Phase 1 done. Realm is still firstAdmin (no flip yet)."
  echo "TEST NOW: log in as $FIRST_ADMIN at $TIDECLOAK_URL/realms/$REALM_NAME/account"
  echo "If that works, run: bash tidecloak/setup.sh phase2"
}

# ============================================================================================
phase2() {
  realm_exists || { echo "Run phase1 first." >&2; exit 1; }
  [ -n "$(user_linked "$FIRST_ADMIN")" ] || { echo "$FIRST_ADMIN is not linked yet (phase1)." >&2; exit 1; }

  local u uid
  echo "==> Creating demo users..."
  for u in "${PHASE2_USERS[@]}"; do [ -n "$(user_id "$u")" ] || create_user "$u"; done
  approve_all_pending

  echo ""
  echo "================ INVITE LINKS (one browser profile each) ================"
  for u in "${PHASE2_USERS[@]}"; do
    uid=$(user_id "$u")
    [ -n "$uid" ] || { echo "ERROR: $u was not created." >&2; exit 1; }
    if [ -z "$(user_linked "$u")" ]; then
      local link; link=$(invite_link "$uid")
      printf '%s %s\n' "$u" "$link" >> "$LINKS_FILE"
      echo "--- $u"; echo "$link"
    fi
  done
  echo "=========================================================================="
  wait_linked "${PHASE2_USERS[@]}"
  approve_all_pending

  echo "==> Granting workspace roles (users are linked, so the grants are signable)..."
  for u in "${PHASE2_USERS[@]}"; do
    local role="${WORKSPACE_ROLE[$u]}"
    [ -n "$role" ] || continue
    api POST "/admin/realms/$REALM_NAME/users/$(user_id "$u")/role-mappings/realm" \
      "[$(api GET "/admin/realms/$REALM_NAME/roles/$role")]" >/dev/null
    echo "  $u -> $role"
  done
  approve_all_pending

  # One-way door: committing this grant flips the realm to multiAdmin. Everything above had to
  # happen first; nothing after this can be approved by script (pack AP-HOST-5).
  echo "==> Granting tide-realm-admin to $FIRST_ADMIN (flips the realm to multiAdmin)..."
  local rm role_json
  rm=$(api GET "/admin/realms/$REALM_NAME/clients?clientId=realm-management" | jq -r '.[0].id')
  role_json=$(api GET "/admin/realms/$REALM_NAME/clients/$rm/roles/tide-realm-admin")
  api POST "/admin/realms/$REALM_NAME/users/$(user_id "$FIRST_ADMIN")/role-mappings/clients/$rm" "[$role_json]" >/dev/null
  approve_all_pending

  echo "==> Exporting adapter config to $ADAPTER_OUTPUT..."
  local cuuid
  cuuid=$(api GET "/admin/realms/$REALM_NAME/clients?clientId=$CLIENT_NAME" | jq -r '.[0].id')
  api GET "/admin/realms/$REALM_NAME/vendorResources/get-installations-provider?clientId=$cuuid&providerId=keycloak-oidc-keycloak-json" > "$ADAPTER_OUTPUT"
  jq -e 'has("jwk") and has("vendorId") and has("homeOrkUrl")' "$ADAPTER_OUTPUT" >/dev/null \
    || { echo "ERROR: $ADAPTER_OUTPUT is missing Tide fields (jwk/vendorId/homeOrkUrl)." >&2; exit 1; }

  echo ""
  echo "Phase 2 done. Realm is multiAdmin; $FIRST_ADMIN is the only realm admin."
  echo "Next (by hand, see docs/tidecloak-setup.md): $FIRST_ADMIN grants tide-realm-admin to admin.b and admin.c."
}

case "${1:-}" in
  phase1) phase1 ;;
  phase2) phase2 ;;
  *) echo "usage: bash tidecloak/setup.sh phase1|phase2" >&2; exit 1 ;;
esac

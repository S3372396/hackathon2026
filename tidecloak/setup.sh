#!/bin/bash
# tidecloak/setup.sh: TideCloak realm for the patient-controlled health journal.
# Adapted from the Tide agent pack's templates/shared/bootstrap-tidecloak.sh. Run from Git Bash.
#
#   bash tidecloak/setup.sh phase1
#       Starts TideCloak (docker compose), creates realm 'health-journal' with its roles and client,
#       licenses it, turns on IGA in Tide mode, creates demo.patient, demo.physio and demo.gp and
#       prints one invite link per user. Each person opens their link in their OWN browser profile
#       and creates a Tide account.
#
#   bash tidecloak/setup.sh status        who has linked a Tide account, and their roles
#   bash tidecloak/setup.sh links         fresh invite links for anyone not linked yet
#
#   bash tidecloak/setup.sh phase2
#       Once all three are linked: signs the IdP settings, grants the app roles (patient,
#       professional) and exports tidecloak/tidecloak.json. Test sign-in after this.
#
#   bash tidecloak/setup.sh phase3
#       ONE-WAY. Makes demo.patient the realm's only tide-realm-admin, which flips the realm from
#       firstAdmin to multiAdmin: from then on every share policy and every admin change needs the
#       patient's approval in the Tide enclave, and this script can no longer approve anything.
#       Then exports the admin policy that signing a share needs (tidecloak/admin-policy.json).
#
#   bash tidecloak/setup.sh admin-policy  re-export tidecloak/admin-policy.json
#
# Start over (deletes the realm; everyone needs a new Tide account afterwards):
#   docker compose --env-file .env -f tidecloak/docker-compose.yml down
#   rm -rf tidecloak/data tidecloak/tidecloak.json tidecloak/admin-policy.json tidecloak/invite-links.txt
#
# Needs: Docker Desktop, curl, jq. Reads .env (gitignored).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TIDECLOAK_URL="${TIDECLOAK_URL:-http://localhost:8080}"
REALM_NAME="${REALM_NAME:-health-journal}"
CLIENT_NAME="${CLIENT_NAME:-health-journal-web}"
# Every origin the web app may be served from. They are signed into the IdP settings in phase2;
# adding one after phase3 needs the patient's approval.
APP_ORIGINS="${APP_ORIGINS:-http://localhost:5173 http://localhost:3001 http://localhost:3000}"
ADAPTER_OUTPUT="tidecloak/tidecloak.json"
ADMIN_POLICY_OUTPUT="tidecloak/admin-policy.json"
LINKS_FILE="tidecloak/invite-links.txt"   # gitignored: invite links are bearer credentials
COMPOSE=(docker compose --env-file .env -f tidecloak/docker-compose.yml)

# Must match server/src/seed.ts.
USERS=(demo.patient demo.physio demo.gp)
declare -A APP_ROLE=([demo.patient]=patient [demo.physio]=professional [demo.gp]=professional)
PATIENT="demo.patient"

# --- Credentials and licence answers: from .env, never hardcoded ---
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
      -H "Content-Type: application/json" --data-binary "$body"
  else
    curl -s -X "$method" "$TIDECLOAK_URL$path" -H "Authorization: Bearer $(get_token)"
  fi
}

# Authorize and commit every pending change request. Works only while the realm is firstAdmin,
# where authorize signs server-side. After phase3 it can approve nothing. Never approves
# DISABLE_IGA, DELETE_REALM or OFFBOARD_REALM.
#
# One pass can miss requests (seen 2026-10-23: of three CREATE_USER requests filed together, only
# one was authorized), so it repeats until nothing is pending or a round changes nothing.
SAFE_PENDING='if type=="array" then [.[] | select(.actionType | IN("DISABLE_IGA","DELETE_REALM","OFFBOARD_REALM") | not)] else [] end'
approve_all_pending() {
  local round id todo ready before after
  sleep 2
  for round in 1 2 3 4 5 6; do
    before=$(api GET "/admin/realms/$REALM_NAME/iga/change-requests?status=PENDING" | jq -r "$SAFE_PENDING | length")
    [ "$before" = "0" ] && return 0
    todo=$(api GET "/admin/realms/$REALM_NAME/iga/change-requests?status=PENDING" \
      | jq -r "$SAFE_PENDING | .[] | select(.readyToCommit != true) | .id")
    for id in $todo; do
      api POST "/admin/realms/$REALM_NAME/iga/change-requests/$id/authorize" '{}' >/dev/null || true
    done
    ready=$(api GET "/admin/realms/$REALM_NAME/iga/change-requests?status=PENDING" \
      | jq -r "$SAFE_PENDING | .[] | select(.readyToCommit == true) | .id")
    for id in $ready; do api POST "/admin/realms/$REALM_NAME/iga/change-requests/$id/commit" >/dev/null || true; done
    sleep 1
    after=$(api GET "/admin/realms/$REALM_NAME/iga/change-requests?status=PENDING" | jq -r "$SAFE_PENDING | length")
    [ "$after" = "0" ] && return 0
    [ "$after" -lt "$before" ] || [ -n "$todo$ready" ] || break
  done
  echo "WARNING: $(pending_count) change request(s) still pending after approval." >&2
}

pending_count() {
  api GET "/admin/realms/$REALM_NAME/iga/change-requests?status=PENDING" | jq -r 'if type=="array" then length else 0 end'
}

realm_exists() { [ "$(curl -s -o /dev/null -w '%{http_code}' "$TIDECLOAK_URL/realms/$REALM_NAME")" = "200" ]; }
user_id() { api GET "/admin/realms/$REALM_NAME/users?username=$1&exact=true" | jq -r '.[0].id // empty'; }
user_linked() { api GET "/admin/realms/$REALM_NAME/users?username=$1&exact=true" | jq -r '.[0].attributes.tideUserKey[0] // empty'; }
user_roles() { api GET "/admin/realms/$REALM_NAME/users/$(user_id "$1")/role-mappings/realm/composite" | jq -r '[.[].name] | join(",")'; }
rm_client() { api GET "/admin/realms/$REALM_NAME/clients?clientId=realm-management" | jq -r '.[0].id'; }
is_realm_admin() {
  api GET "/admin/realms/$REALM_NAME/users/$(user_id "$1")/role-mappings/clients/$(rm_client)/composite" \
    | jq -e 'any(.[]; .name == "tide-realm-admin")' >/dev/null
}

# The realm's user profile requires an email for admin-created users. These are fake demo
# accounts, so they get an address on the reserved .invalid domain, which can never deliver mail.
create_user() {
  local out
  out=$(api POST "/admin/realms/$REALM_NAME/users" \
    "$(jq -n --arg u "$1" --arg e "$1@health-journal.invalid" \
      '{username:$u, email:$e, enabled:true, emailVerified:false, attributes:{tideInvitable:["true"]}}')")
  [ -z "$out" ] || case "$out" in *'"PENDING"'*|*'"status"'*) ;; *) echo "WARNING: creating $1 answered: $out" >&2 ;; esac
}

invite_link() {
  api POST "/admin/realms/$REALM_NAME/tideAdminResources/get-required-action-link?userId=$1&lifespan=43200" \
    '["link-tide-account-action"]'
}

all_linked() {
  local u
  for u in "${USERS[@]}"; do [ -n "$(user_linked "$u")" ] || return 1; done
}

print_links() {
  local u uid link printed=""
  : > "$LINKS_FILE"
  for u in "${USERS[@]}"; do
    [ -n "$(user_linked "$u")" ] && continue
    uid=$(user_id "$u")
    [ -n "$uid" ] || { echo "ERROR: $u does not exist." >&2; exit 1; }
    link=$(invite_link "$uid")
    printf '%s %s\n' "$u" "$link" >> "$LINKS_FILE"
    echo "--- $u"
    echo "$link"
    printed=1
  done
  [ -n "$printed" ] || echo "All demo users are linked."
}

status() {
  local u key
  realm_exists || { echo "Realm '$REALM_NAME' does not exist. Run: bash tidecloak/setup.sh phase1"; return; }
  for u in "${USERS[@]}"; do
    key=$(user_linked "$u")
    printf '%-14s linked: %-3s roles: %s\n' "$u" "$([ -n "$key" ] && echo yes || echo no)" "$(user_roles "$u")"
  done
  echo "pending change requests: $(pending_count)"
}

# ============================================================================================
phase1() {
  echo "==> Starting TideCloak (docker compose)..."
  mkdir -p tidecloak/data
  "${COMPOSE[@]}" up -d
  local i
  for i in $(seq 1 60); do curl -sf "$TIDECLOAK_URL/realms/master" >/dev/null 2>&1 && break; sleep 3; done
  curl -sf "$TIDECLOAK_URL/realms/master" >/dev/null || { echo "ERROR: TideCloak did not start. ${COMPOSE[*]} logs tidecloak" >&2; exit 1; }

  # Resumable: if the realm already exists, its licence and IGA were set up by an earlier run.
  if realm_exists; then
    echo "==> Realm '$REALM_NAME' already exists: keeping its licence and IGA, continuing with users."
  else
    create_realm
  fi

  echo "==> Creating ${USERS[*]}..."
  local u pending_users
  # Skip users whose CREATE_USER request is still pending from an earlier run: a second request for
  # the same username can never commit.
  pending_users=$(api GET "/admin/realms/$REALM_NAME/iga/change-requests?status=PENDING" \
    | jq -r 'if type=="array" then [.[] | select(.actionType=="CREATE_USER") | .rows[0].USERNAME] | join(" ") else "" end')
  for u in "${USERS[@]}"; do
    [ -n "$(user_id "$u")" ] || [[ " $pending_users " == *" $u "* ]] || create_user "$u"
  done
  approve_all_pending
  for u in "${USERS[@]}"; do [ -n "$(user_id "$u")" ] || { echo "ERROR: $u was not created ($(pending_count) pending)." >&2; exit 1; }; done

  echo ""
  echo "================ INVITE LINKS (one browser profile or private window each) ================"
  print_links
  echo "=========================================================================================="
  echo "Each person opens their link, creates a Tide account (any username and password) and clicks"
  echo "Continue once. Then: bash tidecloak/setup.sh status   and, when all are linked, phase2."
}

create_realm() {
  echo "==> Creating realm '$REALM_NAME' (client '$CLIENT_NAME' for: $APP_ORIGINS)..."
  local realm_json
  realm_json=$(sed -e "s|REALM_NAME|$REALM_NAME|g" -e "s|CLIENT_NAME|$CLIENT_NAME|g" tidecloak/realm.json.template \
    | jq --arg origins "$APP_ORIGINS" '($origins | split(" ") | map(select(. != ""))) as $o
        | .clients[0].webOrigins = $o | .clients[0].redirectUris = ($o | map(. + "/*"))')
  api POST "/admin/realms" "$realm_json"
  realm_exists || { echo "ERROR: realm was not created." >&2; exit 1; }

  # Before IGA: afterwards this is a governed write. Stops Keycloak's "Update Account Information"
  # page for every new Tide user. Read back, because a 2xx is not proof it stuck.
  echo "==> Disabling the first-broker-login profile page..."
  local execs cfg val=""
  execs=$(api GET "/admin/realms/$REALM_NAME/authentication/flows/first%20broker%20login/executions")
  cfg=$(printf '%s' "$execs" | jq -r '.[]? | select(.providerId=="idp-review-profile") | .authenticationConfig // empty' | head -1)
  if [ -n "$cfg" ]; then
    api PUT "/admin/realms/$REALM_NAME/authentication/config/$cfg" \
      '{"alias":"review profile config","config":{"update.profile.on.first.login":"off"}}' >/dev/null
  else
    local exec_id
    exec_id=$(printf '%s' "$execs" | jq -r '.[]? | select(.providerId=="idp-review-profile") | .id' | head -1)
    api POST "/admin/realms/$REALM_NAME/authentication/executions/$exec_id/config" \
      '{"alias":"review profile config","config":{"update.profile.on.first.login":"off"}}' >/dev/null
  fi
  cfg=$(api GET "/admin/realms/$REALM_NAME/authentication/flows/first%20broker%20login/executions" \
    | jq -r '.[]? | select(.providerId=="idp-review-profile") | .authenticationConfig // empty' | head -1)
  if [ -n "$cfg" ]; then
    val=$(api GET "/admin/realms/$REALM_NAME/authentication/config/$cfg" | jq -r '.config["update.profile.on.first.login"] // empty')
  fi
  [ "$val" = "off" ] || { echo "ERROR: could not disable the profile page (read back '${val:-unset}')." >&2; exit 1; }

  # A 200 is not proof of a licence: the body is CREATED (licensed) or NEED_PAYMENT (not), and a
  # 303 is a paid checkout.
  echo "==> Licensing the realm with Tide (setUpTideRealm, $LICENSE_EMAIL)..."
  local body code out
  body=$(mktemp)
  code=$(curl -s -o "$body" -w '%{http_code}' -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/vendorResources/setUpTideRealm" \
    -H "Authorization: Bearer $(get_token)" \
    --data-urlencode "email=$LICENSE_EMAIL" --data-urlencode "isRagnarokEnabled=true") || code=000
  out=$(head -c 600 "$body"); rm -f "$body"
  case "$code" in
    2??) ;;
    303) echo "ERROR: setUpTideRealm answered 303 (paid checkout); no licence was issued. $out" >&2; exit 1 ;;
    *) echo "ERROR: setUpTideRealm failed (HTTP $code): $out. See '${COMPOSE[*]} logs tidecloak' ([Midgard] lines)." >&2; exit 1 ;;
  esac
  case "$out" in *NEED_PAYMENT*) echo "ERROR: realm is NOT licensed (NEED_PAYMENT)." >&2; exit 1 ;; esac

  # toggle-iga flips the state on current builds, so call it once and only while IGA is off.
  echo "==> Enabling IGA in Tide mode (quorum-enforced admin changes)..."
  api PUT "/admin/realms/$REALM_NAME" \
    "$(api GET "/admin/realms/$REALM_NAME" | jq '.attributes = ((.attributes // {}) + {"iga.attestor":"tide"})')" >/dev/null
  if [ "$(api GET "/admin/realms/$REALM_NAME" | jq -r '.attributes.isIGAEnabled // "false"' | tr '[:upper:]' '[:lower:]')" != "true" ]; then
    out=$(curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/tide-admin/toggle-iga" \
      -H "Authorization: Bearer $(get_token)" --data-urlencode "isIGAEnabled=true")
    case "$out" in *'"enabled":true'*) ;; *) echo "ERROR: toggle-iga did not enable IGA: $out" >&2; exit 1 ;; esac
    case "$out" in *'"warnings"'*|*commitFailures*) echo "WARNING: toggle-iga reported warnings: $out" >&2 ;; esac
  fi
  approve_all_pending

  local role
  for role in patient professional _tide_encryptor _tide_decryptor _tide_journal.selfencrypt _tide_journal.selfdecrypt; do
    [ "$(api GET "/admin/realms/$REALM_NAME/roles/$role" | jq -r '.name // empty')" = "$role" ] \
      || { echo "ERROR: realm role $role is missing after IGA." >&2; exit 1; }
  done
}

# ============================================================================================
phase2() {
  realm_exists || { echo "Run phase1 first." >&2; exit 1; }
  if ! all_linked; then status; echo "Not every demo user has linked a Tide account yet." >&2; exit 1; fi
  approve_all_pending   # linking writes each user's tideUserKey through change requests

  echo "==> Signing the Tide IdP settings (origins: $APP_ORIGINS)..."
  local inst
  inst=$(api GET "/admin/realms/$REALM_NAME/identity-provider/instances/tide")
  api PUT "/admin/realms/$REALM_NAME/identity-provider/instances/tide" \
    "$(printf '%s' "$inst" | jq --arg d "$TIDECLOAK_URL/realms/$REALM_NAME/tide-console/" '.config.CustomAdminUIDomain=$d')" >/dev/null
  api POST "/admin/realms/$REALM_NAME/vendorResources/sign-idp-settings" >/dev/null
  approve_all_pending

  echo "==> Granting app roles (users are linked, so the grants are signable)..."
  local u role
  for u in "${USERS[@]}"; do
    role="${APP_ROLE[$u]}"
    api POST "/admin/realms/$REALM_NAME/users/$(user_id "$u")/role-mappings/realm" \
      "[$(api GET "/admin/realms/$REALM_NAME/roles/$role")]" >/dev/null
  done
  approve_all_pending
  for u in "${USERS[@]}"; do
    case ",$(user_roles "$u")," in
      *",${APP_ROLE[$u]},"*) echo "  $u -> ${APP_ROLE[$u]}" ;;
      *) echo "ERROR: $u does not have role ${APP_ROLE[$u]} after approval ($(pending_count) pending)." >&2; exit 1 ;;
    esac
  done

  echo "==> Exporting adapter config to $ADAPTER_OUTPUT..."
  local cuuid
  cuuid=$(api GET "/admin/realms/$REALM_NAME/clients?clientId=$CLIENT_NAME" | jq -r '.[0].id')
  api GET "/admin/realms/$REALM_NAME/vendorResources/get-installations-provider?clientId=$cuuid&providerId=keycloak-oidc-keycloak-json" > "$ADAPTER_OUTPUT"
  jq -e 'has("jwk") and has("vendorId") and has("homeOrkUrl")' "$ADAPTER_OUTPUT" >/dev/null \
    || { echo "ERROR: $ADAPTER_OUTPUT is missing Tide fields (jwk, vendorId, homeOrkUrl)." >&2; exit 1; }

  echo ""
  echo "Phase 2 done. The realm is still firstAdmin. Test sign-in for all three users now."
  echo "When sign-in works: bash tidecloak/setup.sh phase3   (one-way: the patient becomes the realm admin)"
}

# ============================================================================================
export_admin_policy() {
  echo "==> Exporting the tide-realm-admin policy to $ADMIN_POLICY_OUTPUT..."
  api GET "/admin/realms/$REALM_NAME/iga/role-policies/name/tide-realm-admin" > "$ADMIN_POLICY_OUTPUT"
  jq -e '.policy | type == "string" and length > 0' "$ADMIN_POLICY_OUTPUT" >/dev/null \
    || { echo "ERROR: no admin policy in the response: $(head -c 300 "$ADMIN_POLICY_OUTPUT")" >&2; exit 1; }
}

phase3() {
  realm_exists || { echo "Run phase1 first." >&2; exit 1; }
  [ -f "$ADAPTER_OUTPUT" ] || { echo "Run phase2 first." >&2; exit 1; }
  if is_realm_admin "$PATIENT"; then
    echo "$PATIENT is already the realm admin (realm is multiAdmin)."
  else
    # One-way door: committing this grant flips the realm to multiAdmin. Everything above had to
    # happen first; nothing after this can be approved by script.
    echo "==> Granting tide-realm-admin to $PATIENT (flips the realm to multiAdmin)..."
    local rm role_json
    rm=$(rm_client)
    role_json=$(api GET "/admin/realms/$REALM_NAME/clients/$rm/roles/tide-realm-admin")
    api POST "/admin/realms/$REALM_NAME/users/$(user_id "$PATIENT")/role-mappings/clients/$rm" "[$role_json]" >/dev/null
    approve_all_pending
    is_realm_admin "$PATIENT" || { echo "ERROR: the grant did not apply ($(pending_count) pending)." >&2; exit 1; }
  fi
  export_admin_policy
  echo ""
  echo "Phase 3 done. $PATIENT approves every share in the Tide enclave from now on."
  echo "$PATIENT must sign out and in again so their token carries tide-realm-admin."
}

case "${1:-}" in
  phase1) phase1 ;;
  phase2) phase2 ;;
  phase3) phase3 ;;
  status) status ;;
  links) realm_exists && print_links ;;
  admin-policy) export_admin_policy ;;
  *) echo "usage: bash tidecloak/setup.sh phase1|status|links|phase2|phase3|admin-policy" >&2; exit 1 ;;
esac

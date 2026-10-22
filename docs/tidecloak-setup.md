# TideCloak setup (Stage 0)

How to get a local TideCloak with the `show-approval` realm, its roles and the demo users.
Everything runs on **your own machine**: the realm, the invite links and the Tide accounts are local
to whoever runs it. Nothing here can be shared between laptops; each person who needs a working
realm runs these steps themselves.

Status when handed over (2026-10-22): the scripts below have run up to the `admin.a` invite link
successfully. The login test after linking has **not** been done yet. See "Known issue" first.

---

## 1. Prerequisites

| Tool | Notes |
|---|---|
| Docker Desktop | Running ("Engine running"). On Windows Home it needs WSL 2: `wsl --install` in an **Administrator** PowerShell, then restart. |
| Git Bash (Windows) or any bash 4+ | The script is bash. On Windows run it from Git Bash, not PowerShell. |
| `curl`, `jq` | Windows: `winget install jqlang.jq`. After installing, open a new terminal so it is on `PATH`. |
| Internet | The realm is licensed against Tide's production network (ork1–ork20.tideprotocol.com). |

Check: `docker compose version`, `jq --version`, `curl --version` all work in the same terminal.

## 2. Configure `.env`

```bash
cp .env.example .env
```

Fill in `.env` (it is gitignored, never commit it):

- `KC_BOOTSTRAP_ADMIN_PASSWORD`: pick a strong password for the local TideCloak master admin.
- `TIDE_LICENSE_EMAIL`: a real email address **you** control. The realm is licensed to it.
- `TIDE_TERMS_ACCEPTED=yes`: only after **you** have read https://tide.org/legal and agree.
  The script refuses to run without both.

## 3. Phase 1: TideCloak, realm, first admin

```bash
bash tidecloak/setup.sh phase1
```

It:
1. starts TideCloak with `docker compose up -d` (image `tideorg/tidecloak-dev:latest`, port 8080, data in `tidecloak/data/`),
2. creates realm `show-approval` from `tidecloak/realm.json.template` (roles below, client `show-approval-web` for `http://localhost:3000`, DPoP-bound tokens),
3. turns off Keycloak's "Update Account Information" page for new Tide users,
4. licenses the realm with Tide (`setUpTideRealm`),
5. enables IGA in **Tide mode** (`iga.attestor=tide`): admin changes become change requests that need admin approval,
6. creates `admin.a` and prints an **invite link** (also saved to `tidecloak/invite-links.txt`, gitignored),
7. waits until `admin.a` is linked, then signs the Tide IdP settings.

It stops **before** making `admin.a` a realm admin, on purpose (see phase 2).

**Your part:** open the invite link in a browser, create a Tide account (username + password of
your choice; this *is* the login from now on) and click Continue **once**. Then test:

> Log in as `admin.a` at http://localhost:8080/realms/show-approval/account

If you reach the account console, continue to phase 2. If not, see "Known issue".

## 4. Phase 2: demo users, roles, admin flip, adapter export

```bash
bash tidecloak/setup.sh phase2
```

It creates `admin.b`, `admin.c`, `pat.production`, `sam.safety`, `val.venue` and prints an invite
link for each. **Each needs its own Tide account**: open each link in a separate browser profile
(or incognito window), create the account, close it. The script waits until all five are linked,
then:

- grants `production_manager` to pat, `safety_officer` to sam, `venue_manager` to val
  (roles are granted only *after* linking: a role given to an unlinked user stays an unsignable
  draft forever),
- grants `tide-realm-admin` to `admin.a`. **This is a one-way switch** (firstAdmin → multiAdmin):
  from here on, no script can approve admin changes; every change needs an admin to approve it in
  the Tide enclave,
- exports the adapter config to `./tidecloak.json` (gitignored; the app reads it in Stage 1).

## 5. By hand: make admin.b and admin.c admins (and see the quorum)

Admin console: http://localhost:8080/admin/show-approval/console/ (log in as `admin.a`).

1. Users → `admin.b` → Role mapping → Assign role → filter by clients → `realm-management` `tide-realm-admin`.
   This creates a **change request**. Change Requests → approve it (the Tide enclave pops up).
   With one admin the threshold is 1, so admin.a's approval is enough.
2. Same for `admin.c` (two admins: threshold `max(1, floor(2 × 0.7))` = 1).
3. Now there are three admins: threshold `floor(3 × 0.7)` = **2**.

**Stage 0 "done when" check:** as `admin.a`, give `pat.production` the `viewer` role (or remove a
role). The change request shows **1 of 2** approvals and nothing changes in pat's roles until
`admin.b` or `admin.c` logs in and approves it.

## Roles in the realm

| Role | Purpose |
|---|---|
| `production_manager`, `safety_officer`, `venue_manager` | Approver roles. Composites include `_tide_encryptor`, `_tide_decryptor` and the `_tide_notes.*` voucher gates. Which notes each can open is decided by per-tag policies in Stage 5, not by these roles alone. |
| `stage_manager` | Drafts and submits; cannot approve. No decrypt capability. |
| `viewer` | Summary and status only. |
| `_tide_encryptor`, `_tide_decryptor` | Names fixed by Tide's built-in `RelationshipAttestation:1` contract (see CLAUDE.md, Notes / deviations). |
| `_tide_notes.selfencrypt/.selfdecrypt` | Voucher gates only; grant no access to any note. |
| `_tide_enabled` | Default role, required for every Tide user. |

Realm admins (`admin.a/b/c`) get **no** workspace or decrypt roles.

## Starting over

```bash
docker compose down
rm -rf tidecloak/data tidecloak/invite-links.txt tidecloak.json
bash tidecloak/setup.sh phase1
```

This deletes the realm. Everyone must create new Tide accounts afterwards (old links stop working).

---

## Known issue (unresolved when handed over)

On the first attempt (same image, a realm called `showgate`), linking succeeded but **every login
failed**. TideCloak's log (`docker compose logs tidecloak`) showed:

```
Tide ORK signing failed during token encode: java.lang.RuntimeException:
  Midgard.SignModel: Error with signing model: TidecloakSessionStartTokenSign:1
[Midgard] SignModel failed: Exception: Not enough orks returned an ok response
```

All 20 Tide ORKs returned HTTP 500, for the app client **and** the built-in admin console, so it
was not app code. A second attempt's browser sign-up then failed with
`Could not reach enough NEW ORKs (got 1 of 20 required, 19 of 20 failed)`, while `curl` from the
same machine reached all 20 ORKs fine. The first account was created after a "Network request
timed out" during sign-up, which may have left it half-registered.

If you hit this:
1. In the browser, F12 → Network → retry once → check the failing ORK requests. A `500` means Tide
   refused; `blocked` / `(failed)` / `net::ERR_*` means something local (extension, antivirus, VPN)
   is blocking.
2. If Tide refused: email **info@tide.org** with the two log lines above, the image
   (`tideorg/tidecloak-dev:latest`) and the date.

## Windows notes

- Run the script from **Git Bash**. It uses `docker compose`, so no `sudo` and no path fix-ups are needed.
- If `docker`, `jq` or `node` are "not found" right after installing, open a new terminal.

# CLAUDE.md — Show Approval Workspace (TideCloak prototype)

## What this project is

A multi-party approval workspace for a theatre production. A team submits a performance plan, registers risky elements (pyro, flying, haze, weapons, strobe, crowd interaction…), attaches sensitive notes, and the show can only be marked **Approved** after separate sign-offs from different roles.

**The core idea: no single person has unilateral control.** No one admin can:
- approve the show alone,
- read every sensitive note,
- silently rewrite who is allowed to approve or read.

TideCloak provides the identity layer, role-gated encryption of sensitive notes, and quorum-governed admin changes. The demo must make it obvious what becomes possible when that unilateral control is removed: production, safety and venue can collaborate in one workspace without having to trust one all-powerful admin.

This is a **prototype for demos**, not production software. Optimise for clarity of the security story over feature breadth.

---

## How we work in this repo

- **Build one stage at a time** (see "Build stages" below). Finish a stage, make it run, show it, then stop and wait for the go-ahead before starting the next stage. Do not scaffold future stages early.
- At the start of each stage: restate the stage goal and its "Done when" checklist, then implement.
- At the end of each stage: run lint/typecheck/tests, list what was built, what was verified, and anything stubbed or deferred. Update the **Progress** section at the bottom of this file.
- Keep changes small and reviewable. Prefer editing existing files over creating parallel versions.
- **Never invent TideCloak APIs.** Before using any TideCloak SDK function, read the installed package's README/types in `node_modules/@tidecloak/*` and match them exactly. SDK versions move fast; if docs and types disagree, trust the types and note it.
- If something can't be enforced by TideCloak in this prototype and is enforced by our own app code instead, say so explicitly in code comments and in the UI (see "Honesty rule").

---

## Tech stack

- **Next.js (App Router) + TypeScript**, Tailwind for styling.
- **TideCloak** server running locally via Docker (use Tide's getting-started setup: `github.com/tide-foundation/tidecloak-gettingstarted`).
- **`@tidecloak/nextjs`** for auth, session, `useTideCloak()`, `<Authenticated>` / `<Unauthenticated>`, edge middleware, and `doEncrypt()` / `doDecrypt()`.
- Adapter config exported from TideCloak as `tidecloak.json` (git-ignored if it contains anything environment-specific; commit a `tidecloak.example.json`).
- **Persistence:** SQLite via Prisma (or Drizzle — pick one in Stage 1 and stick to it). The DB stores sensitive notes **only as ciphertext**.
- **Server-side checks:** every API route verifies the TideCloak access token and reads roles from it. Never trust role claims sent from the client body.
- Testing: Vitest for domain logic (approval state machine, mitigation rules). Playwright optional for the demo flow.

Commands (fill in as they are created):
```
npm run dev        # Next.js dev server
npm run lint
npm run typecheck
npm test
docker compose up  # local TideCloak
```

---

## Domain model

**Show** — title, production company, venue, run dates, performance plan (description, running order, cast/crew counts), status.

**Status lifecycle** (strict state machine, enforced server-side):
```
DRAFT → SUBMITTED → IN_REVIEW → APPROVED
                         ↘ CHANGES_REQUESTED → (resubmit) → IN_REVIEW
```
- Any edit to the plan or risks after SUBMITTED invalidates all existing approvals and returns to IN_REVIEW.
- `APPROVED` is **derived**, never set directly: it is computed from the approval policy + recorded approvals. There is no "force approve" endpoint, for anyone.

**RiskItem** — category (pyrotechnics, flying/rigging, haze/smoke, strobe, stage weapons, stunts/falls, audience interaction, other), description, likelihood, severity, computed risk level, owner role.

**Mitigation** — attached to a RiskItem. Mandatory rules (in `lib/risk-rules.ts`):
- Every risk at or above MEDIUM must have ≥1 mitigation.
- HIGH/CRITICAL risks need a named responsible role and a verification step.
- Certain categories have required mitigations (e.g. pyrotechnics → licensed operator + fire watch; strobe → audience warning signage; flying → rigging inspection cert).
- A show with any unmet mandatory mitigation **cannot be submitted**.

**SensitiveNote** — tag, title (plaintext, non-sensitive), `ciphertext`, author, timestamps. Body is encrypted client-side with `doEncrypt` before it ever reaches our server.

**Approval** — showId, role, approver user id, decision (approve / request changes), comment, timestamp, and the plan version it applies to.

**ApprovalPolicy** — which roles must approve (e.g. `safety_officer` AND `venue_manager` AND `production_manager`), and the rule that one person cannot satisfy two required roles.

**AuditEvent** — append-only log of every submission, approval, decryption attempt (success/denied), and policy change request.

---

## Roles (TideCloak realm roles)

Workspace roles:
| Role | Can see | Can approve as |
|---|---|---|
| `production_manager` | Plan, risks, production notes | Production |
| `safety_officer` | Plan, risks, safety notes, performer-medical notes | Safety |
| `venue_manager` | Plan, risks, venue notes | Venue |
| `stage_manager` | Plan, risks; can draft and submit | — (cannot approve) |
| `viewer` | Plan summary and status only | — |

Encryption tag roles (TideCloak convention: `_tide_<tag>.selfencrypt` to encrypt, `_tide_<tag>.selfdecrypt` to decrypt; a payload with multiple tags requires **all** matching roles):
| Tag | Content | Decrypt granted to |
|---|---|---|
| `production` | budgets, contracts, cast issues | production_manager |
| `safety` | method statements, pyro specs, incident history | safety_officer |
| `venue` | access codes, evacuation routes, structural limits | venue_manager |
| `medical` | performer medical/fitness notes | safety_officer only |

Rules:
- **No role decrypts every tag.** Seed data and docs must keep it that way; add a test that asserts it against the seed config.
- Realm admins are **not** given workspace roles or decrypt roles.
- Separation of duties: one user may not hold two approval roles. Enforce in seed data and check again at approval time.

---

## How TideCloak removes unilateral control (what to demonstrate)

1. **Sensitive notes** — encrypted with `doEncrypt` and tag(s); decryptable only by users whose token carries the matching `_tide_<tag>.selfdecrypt` role. Our DB and server never hold plaintext or keys. A DB dump or a rogue app admin gets ciphertext only.
2. **Role assignments and admin changes** — in TideCloak, changes to users/roles/clients go through change requests that require approval by a quorum of admins before they take effect. So one compromised admin cannot quietly grant themselves `_tide_medical.selfdecrypt` or the `safety_officer` role.
3. **Approval rules** — the approval policy is expressed through TideCloak roles (who holds `safety_officer`, etc.), so changing *who can approve* is a quorum-governed change. Changes to the app-side policy (which roles are required) go through an in-app "policy change request" that needs approvals from multiple distinct admins before it applies — and is labelled as app-enforced.

## Honesty rule

The UI must distinguish clearly between:
- **Cryptographically enforced by TideCloak** (decryption gating, quorum on role/admin changes) — badge e.g. "Enforced by TideCloak".
- **Enforced by this app's server code** (state machine, mandatory mitigations, approval tally, in-app policy change quorum) — badge e.g. "Enforced by app".

Do not claim the app-enforced parts are tamper-proof. Note in the README what a production version would move into TideCloak/Tide-signed policy.

---

## Build stages

Each stage ends in a runnable, demoable state. **Stop after each stage.**

### Stage 0 — Local TideCloak + realm setup
- Docker TideCloak running; realm created; Tide/IGA features activated per the getting-started guide.
- Create realm roles above + `_tide_*` tag roles; create demo users (e.g. `pat.production`, `sam.safety`, `val.venue`, `stella.stage`, `vic.viewer`, plus 3 realm admins `admin.a/b/c`).
- Export adapter config to `tidecloak.json`.
- Write `docs/tidecloak-setup.md` with the exact steps taken.
- **Done when:** each demo user can log in to the TideCloak account console, and a role change by one admin shows as pending until other admins approve.

### Stage 1 — App skeleton + login
- Next.js app, `TideCloakProvider`, login/logout, protected layout, edge middleware.
- Header shows current user and their roles (read from token).
- Server helper `requireUser()` / `requireRole()` that verifies the token for API routes.
- Pick and set up the DB layer.
- **Done when:** logging in as different demo users shows different roles; an API route rejects requests without a valid token.

### Stage 2 — Show submission form
- Create/edit show in DRAFT: title, venue, dates, performance plan, running order.
- Show list + show detail page with status badge.
- Server-side validation (zod).
- **Done when:** stage_manager can create a draft and see it listed; viewer cannot edit.

### Stage 3 — Risk register + mandatory mitigations
- Add/edit risks and mitigations on a show; computed risk level; risk summary panel (counts by level, unmet requirements highlighted).
- `lib/risk-rules.ts` with unit tests.
- "Submit for review" blocked until all mandatory mitigations are met, with a clear checklist of what's missing.
- **Done when:** a show with a HIGH pyro risk and no fire watch cannot be submitted; adding it unlocks submission. Tests pass.

### Stage 4 — Role-separated views
- Each role sees only the sections it should (table above), enforced both in UI and API.
- "Who can see what" panel on the show page.
- **Done when:** the same show looks different for production, safety, venue and viewer, and direct API calls for hidden data return 403.

### Stage 5 — Encrypted sensitive notes
- Add note with a tag → body encrypted client-side via `doEncrypt([{ data, tags }])` → only ciphertext POSTed and stored.
- Note list shows title + tag + lock state; "Reveal" calls `doDecrypt` and shows plaintext only if permitted; denied attempts show a clear "You don't hold `_tide_<tag>.selfdecrypt`" message.
- Log decrypt attempts to the audit trail (outcome only, never plaintext).
- A dev-only "Raw DB view" showing stored ciphertext, to prove the server never sees plaintext.
- **Done when:** safety can read safety+medical notes, venue can read venue notes only, and no single user can reveal all notes.

### Stage 6 — Multi-role approval workflow
- Approval panel listing required roles from the policy, each with status (pending / approved / changes requested, by whom, when).
- Approve / request-changes actions, role-checked server-side; same user cannot approve twice or under two roles; approvals tied to plan version; edits reset approvals.
- **APPROVED** state + final approval banner appears only when the policy is fully satisfied (derived, not stored as a toggle).
- Vitest coverage for the approval state machine.
- **Done when:** the show only becomes Approved after production, safety and venue all approve; editing the plan afterwards drops it back to In Review.

### Stage 7 — Quorum-governed approval rules
- Read-only "Approval rules" page showing the current policy and who holds each approver role (from TideCloak).
- "Propose rule change" creates a pending policy change request; requires approval from N distinct realm admins (not the proposer) before it applies. Proposer cannot approve their own request.
- Link/explain that role membership changes happen in TideCloak and are quorum-approved there.
- **Done when:** one admin proposing "remove Safety from required approvers" stays pending until others approve; a single admin cannot change the rules alone.

### Stage 8 — Audit trail + "compromised admin" demo
- Audit timeline per show and global.
- A guided "What if one admin is compromised?" page that walks through attempts and shows each being blocked: force-approve (no such path), read all notes (ciphertext only / decrypt denied), grant self a decrypt role (pending TideCloak quorum), change rules alone (pending in-app quorum).
- Each step labelled with the Honesty rule badge.
- **Done when:** the full scenario can be clicked through in under 2 minutes.

### Stage 9 — Polish, seed data, docs
- Seed script with a realistic sample show (e.g. a touring musical with pyro, haze, a flying sequence, and stage combat).
- README project overview, `docs/demo-script.md` (2-minute walkthrough), known limitations.
- **Done when:** a fresh clone + documented setup reaches the demo in one sitting.

---

## Conventions

- `app/` routes, `components/` UI, `lib/` domain logic (pure, tested), `lib/server/` auth + DB helpers, `prisma/` (or `db/`) schema + seed, `docs/`.
- Domain logic (risk rules, approval state machine, policy evaluation) lives in pure functions with unit tests, and the API routes call them — never duplicate rules in components.
- Never log, store or send decrypted note contents to the server. Never put sensitive data in URLs.
- No secrets in the repo. `.env.example` for anything configurable.
- Accessible UI: proper labels, keyboard-usable forms, status not conveyed by colour alone.

---

## Progress

- [ ] Stage 0 — Local TideCloak + realm setup — **in progress** (scripts + docs done; phase1 ran to the admin.a invite link; login test and phase2 not yet done; see docs/tidecloak-setup.md "Known issue")
- [ ] Stage 1 — App skeleton + login
- [ ] Stage 2 — Show submission form
- [ ] Stage 3 — Risk register + mandatory mitigations
- [ ] Stage 4 — Role-separated views
- [ ] Stage 5 — Encrypted sensitive notes
- [ ] Stage 6 — Multi-role approval workflow
- [ ] Stage 7 — Quorum-governed approval rules
- [ ] Stage 8 — Audit trail + compromised-admin demo
- [ ] Stage 9 — Polish, seed data, docs

_Notes / deviations:_

- **Note encryption model (agreed 2026-10-22).** `_tide_<tag>.selfencrypt/.selfdecrypt` is Tide *self*-encryption: a note is decryptable only by the user who encrypted it, even if someone else holds the same `selfdecrypt` role (Tide agent pack, marked VERIFIED). That breaks "safety can read safety notes" for notes written by others. Instead, notes use Tide's built-in `RelationshipAttestation:1` contract: one admin-signed policy per tag (`production`, `safety`, `venue`, `medical`) whose subject is a workspace role, enforced by the Tide network. Realm roles `_tide_encryptor`/`_tide_decryptor` (fixed names) come via the approver roles' composites; `_tide_notes.selfencrypt/.selfdecrypt` exist only as voucher gates. One tag per note (the contract rejects multi-tag items), so "requires all tags" does not apply.
- **Demo users (agreed 2026-10-22).** Stage 0 creates 6 of the 8 users: `admin.a/b/c`, `pat.production`, `sam.safety`, `val.venue`. `stella.stage` and `vic.viewer` are added when Stages 2 and 4 need them. Each user is a separate Tide account linked through its own invite link.
- **Stage 0 setup** uses `tidecloak/setup.sh` (adapted from the Tide agent pack's bootstrap) rather than `npm init @tidecloak/nextjs`, because the initializer also scaffolds the Next.js app, which is Stage 1.

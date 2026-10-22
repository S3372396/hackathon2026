# Build plan: patient-controlled health journal (TideCloak)

Instructions for Claude Code. Read this whole file first, then work through the phases in order. Finish and check each phase before starting the next.

## Goal

A web app where a patient logs habits, moods and symptoms, then shares a chosen slice of that data with a chosen medical or allied health professional. The patient can withdraw access later. TideCloak enforces access control and encryption so that the app operator does not need plaintext access.

This is a hackathon prototype. Prefer a small, working, demo-able core over breadth.

## Ground rules

1. **Verify before you claim.** Do not assume TideCloak supports any capability. Phase 0 exists to find out what it really does. If something is not supported, tell me and propose the closest honest alternative. Do not fake it in the UI.
2. **Use only fake data.** No real health information anywhere, including seed data and screenshots.
3. **No medical advice and no compliance claims** in the UI or docs.
4. **Keep secrets out of git.** Use `.env` files and add them to `.gitignore`.
5. **Ask me** before choosing between options that change scope, and before adding any dependency beyond the stack below.
6. After each phase, run the app and tests, and give me a 3-line summary: what works, what doesn't, what's next.

## Default stack (change only with my approval)

- Frontend: React + TypeScript + Vite
- Auth and access control: TideCloak (`@tidecloak/react`), dev instance via Docker image `tideorg/tidecloak-dev:latest`
- Backend and storage: [CONFIRM: ask me. Default is a small Node/Express API with SQLite.]
- Tests: Vitest for logic, plus a scripted end-to-end check of the demo flow

If a Tide MCP server (Raziel, from https://tide.org/agent-plugins) is available in this session, use it for TideCloak questions and implementation details. If it isn't connected, tell me how to add it.

## Phase 0: TideCloak spike (do this first, about 1 hour)

Goal: learn what TideCloak actually supports before designing around it.

- Start the dev instance, activate the license, and run the official playground or a minimal React app with login working.
- Answer these questions with evidence (docs, SDK types, or a working snippet), and write the answers in `docs/tidecloak-findings.md`:
  1. Can the app encrypt a record so only a specific user can decrypt it?
  2. Can encryption be bound to a role or policy, and can a specific user be given or denied access to a specific record?
  3. Can access be withdrawn, and what exactly happens to future decryption attempts?
  4. Does the server or operator ever see plaintext in this design?
  5. What breaks or is unclear?
- **Gate:** if 1 to 3 are not achievable, stop and report to me with options before continuing.

## Phase 1: Data model and logging

- Entities: `User` (patient or professional), `Entry` (type: habit, mood or symptom; value or notes; timestamp), `Share` (entry set, recipient, scope, created date, expiry, status), `AuditEvent`.
- Patient can create, view and edit entries.
- Seed fake data for one patient and two professionals (one physio, one GP).
- **Done when:** a patient can sign in, log entries across several days, and see them on a simple dashboard.

## Phase 2: Sharing

- Share flow: choose professional, choose entries (by date range and entry type), set an expiry, confirm.
- Entries in a share are protected through TideCloak (as established in Phase 0), not just hidden in the UI.
- Professional view: lists shares addressed to them and opens only their own package.
- **Done when:** professional A opens the shared package and professional B, who was not given access, cannot.

## Phase 3: Withdrawal and audit trail

- Patient can withdraw a share at any time, and expiry is enforced.
- After withdrawal, the professional cannot open the package again. Test this properly, not just in the UI.
- Audit view for the patient: who was shared what, when, and whether access is active.
- Be accurate about limits: withdrawal stops future access, and cannot undo data already viewed or copied. Show a short note of this in the UI.
- **Done when:** the full demo path runs end to end (see below).

## Phase 4: Polish and demo

- Clear, simple UI for the three screens: patient dashboard, share flow, professional view.
- A reset script that reseeds the fake data so the demo is repeatable.
- Fill in the `[CONFIRM]` tags in `README.md` to match what is really built, and remove claims the prototype doesn't back up.
- Record a short demo using the path below.

## Optional (only if all phases are done)

- **Leak attribution:** per-recipient marking of non-clinical fields (for example IDs or formatting), so a leaked copy can be matched to a recipient. Describe it as a deterrent, not proof, and never alter medical values.
- Fitness coach recipient role with narrower access than clinical roles.

## Demo path (this is the acceptance test)

1. Patient logs in and logs mood and symptom entries.
2. Patient shares the last 7 days of symptoms with the physio.
3. The physio opens it and sees only those entries.
4. The GP, who was not given access, cannot open it.
5. Patient withdraws access.
6. The physio can no longer open it.
7. The audit trail shows each step.

## Definition of done

- The demo path passes from a clean reset.
- `README.md` matches what is actually built, with no leftover `[CONFIRM]` tags.
- `docs/tidecloak-findings.md` documents what TideCloak does and does not do for this app.
- No secrets in the repo.

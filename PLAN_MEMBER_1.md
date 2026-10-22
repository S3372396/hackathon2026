# Plan for Member 1: Frontend and patient experience

Instructions for Claude Code. Read this whole file first, then work through the tasks in order. Finish and check each task before starting the next.

## Project in one paragraph

We are building a patient-controlled health journal. A patient logs habits, moods and symptoms, then shares a chosen slice with a chosen medical or allied health professional. The patient can withdraw access later. TideCloak, handled by Member 2, enforces who can open what. Your job is everything the user sees.

This is a hackathon prototype. Prefer a small, working, demo-able core over breadth.

## Your boundaries

- **You own:** `/web` (everything except `/web/src/lib/secureShare.ts`).
- **Member 2 owns:** `/server` and `/web/src/lib/secureShare.ts`.
- **Shared:** `/contract`. Do not change it without agreeing with Member 2.
- Work on branch `feat/web`. Merge into `main` only at the integration points below.
- You never wait on Member 2. You build against a mock API and a stub, both described below.

## Ground rules

1. Use fake data only. No real health information anywhere, including screenshots.
2. No medical advice and no compliance claims (such as HIPAA) in the UI.
3. Do not add dependencies beyond the stack below without asking me.
4. Keep secrets out of git. Use `.env` files and add them to `.gitignore`.
5. After each task, run the app, check it works, and give me a 3-line summary: what works, what doesn't, what's next.
6. Never present the stub or mock as real security. Label them clearly in code.

## Stack

React + TypeScript + Vite. For the mock API use MSW (or a small JSON mock server) in `/web/mocks`. Tests with Vitest.

## The shared contract (identical in Member 2's plan)

If `/contract/types.ts` already exists, use it. If not, create it from this section.

```ts
type Role = 'patient' | 'professional';

interface User {
  id: string;
  name: string;
  role: Role;
  profession?: string;           // e.g. "Physio", "GP", "Dietitian"
}

interface Entry {
  id: string;
  patientId: string;
  type: 'habit' | 'mood' | 'symptom';
  title: string;
  value?: number | string;
  notes?: string;
  loggedAt: string;              // ISO date
}

interface Share {
  id: string;
  patientId: string;
  recipientId: string;
  entryIds: string[];
  rangeFrom?: string;
  rangeTo?: string;
  expiresAt: string;
  status: 'active' | 'withdrawn' | 'expired';
  createdAt: string;
}

interface AuditEvent {
  id: string;
  patientId: string;
  shareId?: string;
  action: 'created' | 'viewed' | 'withdrawn' | 'expired' | 'denied';
  actorId: string;
  at: string;
}
```

API:

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/me` | any | Current user |
| GET | `/api/professionals` | patient | List professionals to share with |
| GET / POST / PUT | `/api/entries` | patient | Read, create, edit own entries |
| POST | `/api/shares` | patient | Body: `{ recipientId, entryIds, expiresAt }` |
| GET | `/api/shares` | any | Patient: shares they made. Professional: shares addressed to them |
| GET | `/api/shares/:id/package` | professional | Returns shared entries, or `403` if not allowed, withdrawn or expired |
| POST | `/api/shares/:id/withdraw` | patient | Withdraw future access |
| GET | `/api/audit` | patient | Audit events for own shares |

Secure sharing interface, owned by Member 2 and called by you from `/web/src/lib/secureShare.ts`:

```ts
export function protectEntries(entries: Entry[], recipientId: string): Promise<ProtectedPackage>;
export function openPackage(shareId: string): Promise<Entry[]>;   // rejects if access denied or withdrawn
export function withdrawAccess(shareId: string): Promise<void>;
```

Until Member 2 delivers the real version, create a stub with these exact signatures. It returns plaintext and must carry a comment reading `STUB: NOT SECURE`. Member 2 will replace it, so do not add logic to this file.

## Tasks

### 1. Setup (about 30 minutes)
- Vite + React + TypeScript project in `/web`, routing, basic layout, a role switcher for the demo (patient / physio / GP).
- Create or confirm `/contract` with Member 2.
- **Done when:** the app runs and you can switch between three demo users.

### 2. Mock API and fake data
- MSW handlers that follow the contract exactly, including `403` on `/api/shares/:id/package` for the wrong user, a withdrawn share, or an expired share.
- Seed: 1 patient with about 14 days of entries (habits, moods, symptoms), plus a physio and a GP.
- A reset function that restores the seed data.
- **Done when:** every endpoint in the table responds from the mock.

### 3. Patient logging and dashboard
- Forms to log a habit, mood or symptom (title, value, notes, date). Edit existing entries.
- Dashboard: entries over time, filter by type and date, simple chart or timeline.
- **Done when:** a patient can log entries across several days and see them on the dashboard.

### 4. Share flow
- Steps: choose professional, choose date range and entry types, preview exactly what will be shared, set an expiry, confirm.
- On confirm, call `protectEntries` and `POST /api/shares`.
- **Done when:** a share appears in the patient's shares list with the correct scope and expiry.

### 5. Withdraw and audit trail
- Shares list with status (active, withdrawn, expired) and a withdraw button that calls `withdrawAccess` and `POST /api/shares/:id/withdraw`.
- Audit view listing events: who was shared what, when, and whether access is still active.
- Show a short, visible note: "Withdrawing stops future access. It can't undo data someone already viewed or copied."
- **Done when:** withdrawing changes the status and adds an audit event.

### 6. Professional view
- List of shares addressed to the signed-in professional.
- Open a package via `openPackage` and display only the shared entries.
- Clear states for "access denied", "withdrawn" and "expired". Never show partial data in these states.
- **Done when:** the physio can open their package and the GP sees "access denied" for it.

### 7. Polish and demo
- Empty states, error states, loading states, consistent styling, mobile-friendly layout.
- A visible "Reset demo" control.
- Update the `[CONFIRM]` tags in `README.md` for the UI features that exist.
- **Done when:** the demo path below passes from a clean reset.

## Integration points with Member 2

| When | What |
| --- | --- |
| Start | Agree and commit `/contract` together |
| After Member 2's Phase 0 | Read `docs/tidecloak-findings.md`. If it changes the contract, update it together before continuing |
| Midpoint | Swap the mock API for the real server. Keep the stub if the real crypto isn't ready |
| Final | Member 2's real `secureShare.ts` replaces the stub, then run the demo path from a clean reset |

If Member 2 changes anything that affects your code, ask them to tell you directly. Do not guess.

## Demo path (acceptance test)

1. Patient logs in and logs mood and symptom entries.
2. Patient shares the last 7 days of symptoms with the physio.
3. The physio opens it and sees only those entries.
4. The GP, who was not given access, cannot open it.
5. Patient withdraws access.
6. The physio can no longer open it.
7. The audit trail shows each step.

## Definition of done

- The demo path passes from a clean reset.
- No hidden or partial data is ever shown in a denied state.
- The UI never claims more than the system does.
- No secrets in git, and fake data only.

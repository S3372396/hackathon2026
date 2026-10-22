# [App Name]: a patient-controlled health journal

Log your habits, moods and symptoms, then share only what a medical or allied health professional needs to see. You choose who sees what, and you can withdraw access later.

## Project overview

[App Name] is a health tracker where people record habits, moods and symptoms day to day. When they see a GP, physio, dietitian or other allied health professional, they can share a chosen slice of that history, for example "my symptom log for the last 14 days", without handing over unrelated private entries such as mood notes.

Health tracking apps usually become one more place where sensitive data is collected and broadly readable by whoever runs the platform. We built [App Name] around selective disclosure instead: the patient decides the recipient, the scope and the duration, and can withdraw access for the future.

Sharing is built on TideCloak, so that access to shared records is enforced by cryptographic access control and not only by a screen in our UI. `[CONFIRM: describe exactly what TideCloak enforces in your build, e.g. per-record encryption, recipient-bound decryption.]`

## Vision and originality

A health journal is common. A patient-controlled sharing layer is the distinctive part. Our focus is on the moment of disclosure:

- **Select what to share**: pick specific entries or a date range, not the whole record.
- **Select who sees it**: a named professional, with a role (medical or allied health).
- **Control the duration**: set an end date, or withdraw earlier.
- **See the trail**: a log of what was shared, with whom, when, and whether access is still active.

Fitness coaching is a separate recipient role with narrower access than clinical roles, since coaches rarely need symptom or mood data. `[CONFIRM: keep or remove if not built.]`

## Trust constraint insight

Sharing health information normally requires trusting a platform, or a provider's system, with the full dataset, and once it is copied in, the patient loses control over it. Two trust problems follow:

1. The platform operator can read everything.
2. Sharing is all-or-nothing and effectively permanent.

[App Name] aims to remove the first by not giving the platform universal access to plaintext, and to soften the second by letting patients scope shares and withdraw future access. `[CONFIRM: only keep the first claim if your implementation really prevents operator access to plaintext.]`

## Value and impact

- **Patients** keep ownership of their health story and can bring useful history into appointments without oversharing.
- **Professionals** receive focused, relevant context (for example, two weeks of symptom logs) rather than a full diary.
- **Care teams** get a clearer picture between visits.

## Why TideCloak matters

Selective sharing is only credible if it is enforced by the system and not just by an interface that hides things. TideCloak is an identity and access management system built on Keycloak that distributes control of its keys across a decentralised network, so that no single party, including an administrator, holds them. We use it to `[CONFIRM: e.g. protect shared records, restrict decryption to the intended recipient, and stop future access on withdrawal]`.

## Prototype and storytelling

The demo walks through one journey:

1. A patient logs several mood and symptom entries.
2. They share only the last 7 days with one professional.
3. That professional signs in and can open only the shared package.
4. A second professional who was not given access cannot open it.
5. The patient withdraws access, and the first professional can no longer open new or updated data.

`[CONFIRM: remove any step you haven't built; add a link to your demo video.]`

## Features

| Feature | Status |
| --- | --- |
| Log habits, moods and symptoms | UI built (runs on a mock API for now) |
| Patient dashboard | UI built (mock API): trend charts, timeline, type and date filters |
| Share selected entries with a chosen professional | UI built (mock API). Sharing protection is a placeholder until the TideCloak integration lands |
| Scope and duration controls | UI built (mock API): date range, entry types, per-entry selection, expiry |
| Withdraw future access | UI built (mock API). Enforcement depends on the TideCloak integration |
| Clinician view | UI built (mock API): opens shared entries, with clear denied, withdrawn and expired states |
| Sharing audit trail | UI built (mock API): shows each share, view, refusal, withdrawal and expiry to the patient |
| Per-recipient copy marking for leak attribution (optional) | `[CONFIRM]` |

## Honest limits

- **Withdrawal stops future access, not past access.** If a professional already viewed, copied or screenshotted data, withdrawing cannot undo that.
- **Leak attribution is a deterrent, not proof.** Per-recipient marking helps point to a likely source, but marks can be removed or blurred if recipients compare copies. We apply markings only to non-clinical fields so that medical values are never altered.
- **Metadata can be sensitive.** Even when contents are protected, the fact that a share happened may be revealing. `[CONFIRM: say what your audit log shows and to whom.]`
- **Not medical advice, and not a compliance claim.** [App Name] is a prototype. It does not diagnose, and we do not claim compliance with any health privacy regulation.

## Tech stack

- Frontend: React, TypeScript and Vite in `/web`, with an MSW mock API and Vitest
- Backend / database: `[CONFIRM]`
- Access control and encryption: TideCloak (`@tidecloak/react` SDK) `[CONFIRM]`

## Running locally

```bash
# 1. Start a TideCloak dev instance
docker run --rm -p 8080:8080 \
  -e KEYCLOAK_ADMIN=admin -e KEYCLOAK_ADMIN_PASSWORD=password \
  tideorg/tidecloak-dev:latest

# 2. Activate the license in the TideCloak admin console (http://localhost:8080)

# 3. Install and run the frontend (uses its mock API until the server is connected)
cd web
npm install
npm run dev   # [CONFIRM: add the server commands]
```

Use development credentials only. Do not enter real health information into a prototype.

## Team

`[CONFIRM: names / roles]`

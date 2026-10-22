# ShowGate

Hackathon 2026, Challenge 2 (Tide). A multi-party show approval workspace for a theatre production.

A production lead submits a performance plan and lists its risky elements. Production, safety and venue each keep sealed notes, and each role signs off separately. The show is only marked **Approved: cleared for performance** once every required role has signed off on the current version of the plan.

Nobody can approve the show, read every note or rewrite the rules alone, and that includes the admins.

## What is protected, and by what

| Claim | Mechanism |
|---|---|
| A show needs separate sign-offs | The API (`/api/shows/approve`) checks the verified, DPoP-bound token: you must hold the role, the role must be required by the rules, and one person counts for one role only. Revising the plan bumps its version, and old sign-offs stop counting. |
| Mitigations are mandatory | A medium or high risk with no mitigation or owner blocks every sign-off. This is enforced on the server. |
| Sealed notes per role | Notes are encrypted in the browser with Tide's built-in `RelationshipAttestation:1` contract. Each compartment has a policy whose subject is one role (`sg-production`, `sg-safety`, `sg-venue`). The **Tide network** refuses to decrypt for anyone without that role, and the ShowGate server only ever holds ciphertext. |
| No admin can read every note | An admin has no compartment role. To get one, they need a role grant, which is a TideCloak IGA change request. With 3+ admins, the quorum is `floor(0.7 × admins)`. |
| No admin can rewrite the rules | The rules live in a TideCloak client mapper (`ShowGate approval rules`, claim `showgate_rules`). They arrive inside the signed access token, and the server only reads them from the verified token. Editing the mapper is a change request that needs the admin quorum. |
| Tokens can't be forged or replayed | Tide threshold signing. The server verifies tokens against the adapter's embedded JWKS and checks the DPoP proof on every API route. |

Being honest about the limits: show sign-offs are recorded by the ShowGate server after it verifies the token. They are not threshold-signed by Tide. The next step would be Tide's `policy-governed-signing` pattern, so each sign-off becomes a network signature.

## Run it

You need: Node 18+, Docker Desktop (running), Git Bash, `curl` and `jq`.

```bash
npm install
npm run init     # starts TideCloak in Docker, creates the realm, waits for you to link the admin account
npm run dev      # http://localhost:3000
```

`npm run init` reads `.env`, which is gitignored and holds the TideCloak master-admin password, the Tide licence email and the terms acceptance. It prints an **invite link**. Open it and link your Tide account: that account becomes the first realm admin.

## First-time setup (once)

1. **Sign compartment policies.** Log in as the admin, open **Governance → Sealed-note compartments**, and click **Sign policy** for Production, Safety and Venue. Each click opens the Tide enclave, and that approval is the grant. Do this before adding more admins, so it takes one approval rather than a quorum.
2. **Add the crew.** Each person logs in to ShowGate once with their own Tide account, in a separate browser profile. In the TideCloak admin console (link on the Governance page), give each one a role: `sg-production`, `sg-safety` or `sg-venue`. Every grant is a change request. Approve it under **Change Requests**.
3. **Remove unilateral control.** Grant `tide-realm-admin` (a client role on `realm-management`) to the three crew members as well. With four admins, every later role grant or rule change needs 2 approvals.

Everyone logs out and back in after a role change, so their token picks it up.

## 2-minute demo

1. **Production** submits a plan with a high-risk element ("Flash pots, Act 2") but leaves the mitigation blank. The risk summary flags it, and nobody can sign off.
2. **Production** revises the plan to add the mitigation and an owner, then adds a sealed production note.
3. **Safety** opens the show. The production notes show as 🔒 Sealed and safety can't decrypt them. Safety adds a safety note and signs off.
4. **Venue** signs off. **Production** signs off, and the banner turns green: *Approved: cleared for performance.*
5. **Production** revises the plan again. All sign-offs are reset to "older version".
6. **Admin** tries to drop the venue sign-off by editing the `ShowGate approval rules` mapper. It sits under Change Requests at 1 of 2 approvals, and nothing changes until a second admin signs.

## Layout

```
src/app/page.tsx                  landing + show list
src/app/shows/new/page.tsx        submission form
src/app/shows/[id]/page.tsx       plan, risk summary, sign-offs, sealed notes, final state
src/app/governance/page.tsx       rules in force, compartment policies, pending change requests
src/app/api/*                     every route wrapped in withAuth/withRole (JWT + DPoP verified)
src/lib/showgate/                 model, approval logic, file store
src/lib/tide/relationship.ts      Tide pack helper for RelationshipAttestation:1
scripts/realm.json.template       roles sg-*, rules mapper, DPoP-bound client
```

Data lives in `data/showgate/*.json`, which holds ciphertext and signed policy bytes only. It's fine for a demo, not for production.

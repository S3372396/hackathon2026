# TideCloak findings (Task 1 spike)

Date: 2026-10-23. Author: Member 2. Status: research done, **live checks on our own TideCloak not yet run** (they need each demo user to create a Tide account in a browser; see "Next: live checks").

## How to read the evidence

| Label | Meaning |
| --- | --- |
| **Tide-verified** | Tide's agent pack (MCP server `mcp.tide.org`) says Tide read it from the ORK source or measured it end to end. We have not run it ourselves. |
| **Checked by us** | We read it ourselves in the published SDK, the official docs or the playground repo. |
| **Not yet verified** | Nobody has shown it on our setup. Treat as a plan, not a fact. |

Sources:

- Tide agent pack via `https://mcp.tide.org/mcp`, read 2026-10-23: scenario `relationship-attestation` (scenario, role matrix, bootstrap sequence), template `templates/relationship-attestation/relationship.ts`, canon `concepts`, canon `troubleshooting`, gap register.
- Official docs `https://docs.tide.org` (React how-to guide, Hermetic E2EE page), read 2026-10-23.
- Playground `github.com/tide-foundation/tidecloak-playground` at commit `5f33fb8` (2026-08-03).
- npm packages: `@tidecloak/react@0.14.33` (current `latest`), `@tidecloak/js@0.14.41`.

## Answers in short

| # | Question | Answer |
| --- | --- | --- |
| 1 | Encrypt a record so only one specific user can decrypt it? | **Yes**, with a signed policy under Tide's built-in contract `RelationshipAttestation:1`. Catch: a realm admin must approve every policy in the Tide enclave. |
| 2 | Bind encryption to a role or policy; give or deny a specific user access to a specific record? | **Yes.** A policy binds one subject (a user, group or role) to one record id. Anyone the policy does not name is refused by the Tide network. |
| 3 | Withdraw access; what happens to later decryption? | **Partly.** No instant per-user, per-record revocation. Policy expiry is enforced by the network. Withdrawal before expiry is enforced by our server (it deletes the ciphertext and stops serving the policy). |
| 4 | Does the server or operator see plaintext? | **Not for shared packages** in the design below. **Yes for journal entries** under the current contract, unless entries are encrypted in the browser too (proposed). |
| 5 | Where do encryption and decryption happen? | **Browser only**, with live help from the Tide ORK network. Our server cannot encrypt, decrypt or sign policies. |
| 6 | Unclear, limited or broken? | See section 6. The biggest items: admin approval per grant, the contract is one week old and unconfirmed on our network, and logins failed on this machine on 2026-10-22. |

## 1. Encrypt a record so only one specific user can decrypt it

**Yes, through policy-based encryption, not through the encryption shown in the official docs.**

Two encryption models exist:

| Model | SDK call | Who can decrypt |
| --- | --- | --- |
| Self-encryption (official docs, playground) | `doEncrypt([{ data, tags: [tag] }])` | Only the user who encrypted it. Needs realm roles `_tide_<tag>.selfencrypt` / `_tide_<tag>.selfdecrypt`. Giving someone else the `selfdecrypt` role does **not** let them read your data. |
| Policy-based | `doEncrypt([{ data, tags: [recordId] }], signedPolicy)` | Whoever the signed policy names, checked by every ORK on every call. |

For our case the policy uses the built-in contract `RelationshipAttestation:1`:

| Policy field | Value for "only the physio can read share X" |
| --- | --- |
| `subjectType` | `User` |
| `subjectId` | the physio's `tideuserkey` claim, copied as-is |
| `assignmentId` | the record id (our package id); it must also be the **only** tag on the data |
| `roles` | `'["_tide_decryptor"]'` (a JSON string): read only |
| expiry | optional, seconds since epoch; checked by the network |

The caller must also hold the realm role `_tide_decryptor` (to read) or `_tide_encryptor` (to write). A role alone opens nothing and a policy alone opens nothing.

Evidence:

- Tide-verified: contract rules read from ORK source `main @ c69fc4f6` (2026-10-16). `User`, `Group`, `Role` subjects and the refusals (wrong user, missing `_tide_decryptor`, wrong or extra tag) measured end to end on 2026-10-16. A sign, encrypt and decrypt round was measured on a five-ORK local test stack on 2026-10-13, including "data encrypted under one policy decrypted under another for the same record".
- Checked by us: `@tidecloak/js@0.14.41` declares `doEncrypt(data, decryption_policy?: Uint8Array)` and `doDecrypt(data, decryption_policy?: Uint8Array)` (`dist/types/IAMService.d.ts`). `@tidecloak/react@0.14.33` forwards the policy to `IAMService` (`dist/esm/contexts/TideCloakContextProvider.js`, lines 535 to 540).
- Checked by us: the official React guide and the playground only show self-encryption. Policy-based sharing is documented only in Tide's agent pack.
- Not yet verified: that the Tide network our dev TideCloak talks to has this contract. Tide marks this ASSUMED for networks updated since 2026-10-16. If policy signing fails with an unknown contract, the pack says to stop and ask Tide (info@tide.org).

The catch: **every policy is signed by the network only after a `tide-realm-admin` approves it in the Tide enclave** (a browser pop-up). A server or a script cannot sign one (the backend gets `requiresApprovalPopup: true` and cannot finish). The pack is explicit that if the grant must be made by the data owner rather than a realm admin, this contract does not fit as-is. That is the main design decision below.

Also: the recipient must have signed in once before they can be named, because until then they have no Tide key.

## 2. Bind encryption to a role or policy; give or deny one user access to one record

**Yes.**

- Role-bound: self-encryption tags are gated by `_tide_<tag>.selfencrypt` / `.selfdecrypt` realm roles, but this only covers the encrypting user's own data (checked by us, official docs).
- Policy-bound: one `RelationshipAttestation:1` policy binds one subject to one record (Tide-verified):
  - `User`: exactly one person (their key).
  - `Group`: every member, matched against the token's `groups` claim (full path, e.g. `/shares/abc`).
  - `Role`: every holder of a realm role (or a client role with `clientId`).
- **Give** access: sign a policy naming that user and that record.
- **Deny** access: anyone the policy does not name is refused by the ORKs (`subjectId does not match.`). There is no explicit deny list; denial is the absence of a policy, or not being in the group or role.
- Read and write are separate grants: `["_tide_decryptor"]` reads, `["_tide_encryptor"]` writes. A read-only policy cannot encrypt (Tide-verified).
- One tag per item, and it must equal the record id. Two tags are refused (Tide-verified).

## 3. Withdraw access, and what happens to later decryption attempts

**Partly. A signed `User` policy cannot be revoked before its expiry.** Tide's pack lists these levers (Tide-verified unless marked):

| Lever | What a later decryption attempt gets | Limit |
| --- | --- | --- |
| Our server deletes the package ciphertext and stops serving the policy | `GET /api/shares/:id/package` returns `403`, so `openPackage` rejects. | Enforced by our server, not by Tide. A recipient who saved **both** the ciphertext and the policy bytes before withdrawal could still decrypt until the policy expires. |
| Policy expiry (we would set it to the share's `expiresAt`) | The network refuses every decryption after expiry, for everyone, even with saved copies or a compromised server. | Fixed at signing time. The exact error text for an expired policy is not documented. |
| Per-share `Group` or `Role` subject; withdraw by removing the recipient from it | Refused once the recipient's credential refreshes (access-token lifetime, about 10 minutes in our realm template, plus up to 120 s). | Tide marks the timing INFERRED, not measured. Each share and each withdrawal costs an extra admin-approved change request. |
| Remove `_tide_decryptor` from the recipient | Refused for **all** records of that recipient. | Too coarse for one share. |

Refusals reach the browser as `TIDE-TIDEJS-NET-THRESHOLD_FAILURE: Could not reach enough VVK ORKs`, with the contract's reason in the error's `cause`. This looks like an outage but is a refusal; the UI must show "no access" and not retry (Tide-verified).

Nothing can undo data that was already decrypted, viewed, screenshotted or copied.

## 4. Does the server or operator ever see plaintext?

- **Shared packages, design below: no.** The patient's browser encrypts the package; the professional's browser decrypts it. Our server stores ciphertext and signed policy bytes. TideCloak itself does not decrypt data and holds no data keys (official Hermetic E2EE page). The server cannot decrypt (it has no user credential) and cannot add a reader (that needs an enclave-approved policy) (Tide-verified).
- **Journal entries, current contract: yes.** `/api/entries` carries plaintext `Entry` objects, so the operator can read every entry, including the ones in a share. To remove this, the patient's browser must self-encrypt entry contents before upload. That changes the contract (proposal below).
- **Metadata the server always sees:** who shared with whom, when, expiry and status, entry ids, and any fields we leave in clear (we would keep `type` and `loggedAt` in clear for filtering). A signed policy names the recipient's public key and the record id in clear.
- **Caveat for any web E2EE:** the operator serves the app's JavaScript. A malicious operator could ship code that leaks plaintext from the browser. Tide does not change that.

## 5. Where encryption and decryption happen

- **Browser only.** `doEncrypt` / `doDecrypt` run in the user's browser with the user's session credential (the "doken") through the Tide enclave. The SDK's type docs say both are unavailable in its hybrid mode, where tokens live on a server, because "encryption requires client-side doken" (checked by us).
- Each call needs the ORK network online; there is no offline decryption (Tide-verified). Calls take arrays, so many entries can go in one call.
- Policy signing also happens in a browser: the approving admin's.
- Our server verifies tokens, enforces API rules, and stores ciphertext and policies.

## 6. Unclear, limited or broken

1. **Admin approval per grant.** Every share needs a `tide-realm-admin` to approve its policies in the enclave. For a patient-controlled app, the demo works only if the patient is the approving admin (option A below). That does not scale to many patients in one realm. A production fix would be a custom Forseti contract where the record owner approves, which is not self-service (Tide deploys custom contracts).
2. **New contract, unconfirmed on our network.** `RelationshipAttestation:1` has been in ORK `main` only since 2026-10-16. Tide's helper `relationship.ts` "type-checks" but its own README says it was **not run**. It uses the SDK's internal `IAMService._tc`, because there is no public policy-signing API yet.
3. **Logins failed on this machine on 2026-10-22** with `tideorg/tidecloak-dev:latest` (previous prototype). All 20 ORKs refused `TidecloakSessionStartTokenSign:1` (HTTP 500), and a browser sign-up reached only 1 of 20 ORKs. Unresolved. Tide's troubleshooting guide lists "ORK PreSign failure: on a stale realm, recreate it", and we will create a new realm anyway. Must be re-tested before we promise sign-in works.
4. **Withdrawal is not instant at the network level** (section 3).
5. **Every demo user needs a real Tide account**, created through an invite link in a browser; this cannot be scripted. Use one browser profile per demo user.
6. **Role and group changes reach a user only on their next token refresh** (up to 120 s after the change is committed, plus the token lifetime).
7. **Server-side checks are still ours to build.** The contract protects data, not our API. Every route must verify the TideCloak JWT (EdDSA) and, with DPoP on (the pack's default), the DPoP proof.
8. **SDK packages.** Policy building imports `@tideorg/js` (`Models.Policy`) and `heimdall-tide` (`PolicySignRequest`). Both are already dependencies of `@tidecloak/react` (through `@tidecloak/js`), so nothing new is downloaded, but importing them directly means listing them in `package.json`.
9. **Documentation gap.** The official docs and the playground only cover self-encryption.

## Gate result

- Q1 and Q2: achievable (Tide-verified; not yet run on our setup).
- Q3: partly. Withdrawal is enforced immediately by our server and by the network at expiry. There is no instant network-level revocation for one share.
- The findings change the contract. The chosen option and the proposed contract changes are below; the contract changes still need Member 1's agreement.

## Design options

**A. Patient approves their own shares (recommended for the demo).** The demo realm has one patient, who is its only `tide-realm-admin`. For each share, the patient's browser builds two `RelationshipAttestation:1` policies for a new package id: the patient may write (expiring shortly after creation), and the recipient may read (expiring at `expiresAt`). The patient approves them in the Tide enclave, encrypts the selected entries, and uploads the ciphertext with the recipient's policy.

- Enforced by the network: only the named professional can decrypt; nobody can after expiry; a tampered recipient or scope on our server does not help anyone decrypt.
- Enforced by our server: API roles, withdrawal (deletes the ciphertext, stops serving the policy), `403` responses, the audit log.
- Cost: one enclave approval per share. The SDK takes both requests in one call, so one pop-up is likely, but this is not yet verified.
- Limit: one patient per realm, and that patient holds realm-admin rights. The README must say so.

**B. A clinic admin approves each share.** Same mechanism, but a separate admin account approves. Not patient-controlled: the admin becomes the gatekeeper.

**C. Hybrid with browser crypto.** Tide self-encryption protects each professional's private key; the patient encrypts the package to the professional's public key with WebCrypto (built into browsers, no new dependency). Fully patient-driven with no admin approvals. But recipient binding then rests on our own key handling: a malicious server could hand out a substituted public key. Expiry and withdrawal are server-enforced only, and Tide's part is much smaller.

**D. Stronger withdrawal (add-on to A).** Use a per-share role as the policy subject, and withdraw by removing the role. The network then refuses within about one token lifetime. Costs extra approvals per share and per withdrawal, and Tide marks the timing INFERRED.

For journal entries:

- **E1. Leave entries in plaintext on the server.** The contract is unchanged, but the README must not claim the operator cannot read the journal.
- **E2. Self-encrypt entry contents in the browser (recommended).** Encrypt `title`, `value` and `notes` with tag `journal` (patient roles `_tide_journal.selfencrypt` / `.selfdecrypt`). Keep `id`, `patientId`, `type` and `loggedAt` in clear for filtering.

## Decision (2026-10-23): A + E2, with C as the fallback

| Criterion | A | B | C | A + D |
| --- | --- | --- | --- | --- |
| Only the named professional can decrypt, enforced by | Tide network | Tide network | our own key handling (a server could swap public keys) | Tide network |
| Patient makes the grant | yes | no | yes | yes |
| Expiry enforced by | network and server | network and server | server only | network and server |
| Withdrawal enforced by | server now, network at expiry | same as A | server only | network within about one token lifetime |
| Extra approvals | one enclave approval per share | one per share, by an admin | none | several per share and per withdrawal |
| Main risk | contract unconfirmed on our network | same as A | lowest (self-encryption is in the official docs) | highest (timing not measured) |

- **A** is the only option where Tide, not our code, enforces both "only this professional" and "not after expiry", while the patient makes the grant.
- **D** adds approvals for a guarantee the plan does not require (the plan only promises that withdrawal stops future access).
- **E2** is what makes the "operator does not need plaintext" claim true. Without it, protecting the shared copy changes nothing for the operator.
- **Fallback:** if the live checks show our network lacks `RelationshipAttestation:1`, switch to **C**. The UI is not affected, because it treats `ProtectedPackage` as opaque. Only `secureShare.ts` and the server change.

## Proposed contract changes (pending Member 1's agreement)

Proposed on branch `feat/secure-sharing` in `/contract/types.ts` and `/contract/README.md`. Changes from the plan's contract:

1. `ProtectedPackage` is used by `protectEntries` but never defined. Proposal:
   ```ts
   export interface ProtectedPackage {
     packageId: string;        // record id: the only tag on the ciphertext and the policies' assignmentId
     recipientId: string;
     expiresAt: string;
     ciphertext: string;       // Tide-encrypted JSON of Entry[]
     recipientPolicy: string;  // base64 signed policy: recipient may read packageId until expiresAt
   }
   ```
2. `protectEntries(entries, recipientId, expiresAt)`: add `expiresAt`, so the network enforces the expiry the patient picked.
3. `POST /api/shares` body: `{ recipientId, entryIds, expiresAt, package: ProtectedPackage }`.
4. `GET /api/shares/:id/package` returns the `ProtectedPackage` (ciphertext), not plaintext entries. `openPackage(shareId)` keeps its signature: it decrypts in the browser and returns `Entry[]`.
5. `User` gains `tideUserKey?: string` (a public key). `GET /api/professionals` returns it, because a policy must name the recipient's key.
6. E2 only: `/api/entries` carries `EncryptedEntry { id, patientId, type, loggedAt, ciphertext }`, and `secureShare.ts` gains `encryptEntry(entry)` and `decryptEntries(rows)` so the UI keeps working with plain `Entry` objects.

## Next: live checks (need the patient, physio and GP to each create a Tide account)

1. Start `tideorg/tidecloak-dev:latest`, create and license a fresh realm, link the three demo accounts. This also re-tests the 2026-10-22 login failure.
2. Run Tide's checks for the contract: the granted user round-trips; a different tag, two tags, another user's policy, a missing `_tide_decryptor` and a write with a read-only policy are all refused.
3. Run ours: the physio opens the package; the GP is refused by the network even if our server hands them the package; after expiry everyone is refused; after withdrawal the API returns `403`.
4. Record what the network actually returned in this file, and update the labels above.

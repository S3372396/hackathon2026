# Shared contract

`types.ts` and this file are the contract between Member 1 (UI) and Member 2 (server and secure sharing). Change them only with both members agreeing.

**Status: PROPOSED by Member 2 on 2026-10-23, not yet agreed with Member 1.** The base is the contract in both plans. The changes come from the TideCloak spike (`docs/tidecloak-findings.md`, decision A + E2).

## What changed from the plan, and why

| Change | Why |
| --- | --- |
| `ProtectedPackage` defined | The plan uses it but never defines it. |
| `protectEntries` takes `expiresAt` | The Tide network enforces expiry only if the policy is signed with it. |
| `POST /api/shares` also carries `package` | The encrypted entries are made in the patient's browser and uploaded with the share. |
| `GET /api/shares/:id/package` returns a `ProtectedPackage` | It returns ciphertext. `openPackage` decrypts it in the professional's browser and still returns `Entry[]`. |
| `User.tideUserKey` | A share's policy must name the recipient's Tide key. |
| `/api/entries` carries `EncryptedEntry` | Entry contents are encrypted in the browser, so the operator cannot read the journal. `encryptEntry` / `decryptEntries` let the UI keep working with plain `Entry` objects. |
| `PUT /api/entries` takes the id in the body | As in the plan's table and Member 1's mock API. |

## Calling the API

The real server needs a TideCloak token with a DPoP proof on every `/api` call. Send requests through the SDK's `secureFetch` (from `useTideCloak()`, or `IAMService.secureFetch`):

- pass an **absolute** URL, e.g. `new URL('/api/me', location.origin).href` (the SDK builds the proof with `new URL(url)`, so a relative path throws);
- send **no** `Authorization` header; `secureFetch` attaches `Authorization: DPoP <token>` and the `DPoP` proof itself.

The mock API can ignore this.

JSON in and out. Every 4xx body is `{ "error": "..." }`.

## Endpoints

| Method | Path | Who | Request | Success |
| --- | --- | --- | --- | --- |
| GET | `/api/me` | any | | `200` `User` |
| GET | `/api/professionals` | patient | | `200` `User[]` (with `tideUserKey`) |
| GET | `/api/entries` | patient | | `200` `EncryptedEntry[]`, own entries, newest first |
| POST | `/api/entries` | patient | `EntryUpload` | `201` `EncryptedEntry` |
| PUT | `/api/entries` | patient | `{ id }` plus `EntryUpload` | `200` `EncryptedEntry` |
| POST | `/api/shares` | patient | `CreateShareRequest` | `201` `Share` |
| GET | `/api/shares` | any | | `200` `Share[]`. Patient: shares they made. Professional: shares addressed to them. |
| GET | `/api/shares/:id/package` | professional | | `200` `ProtectedPackage` |
| POST | `/api/shares/:id/withdraw` | patient | | `200` `Share` (already withdrawn or expired: `200`, no change) |
| GET | `/api/audit` | patient | | `200` `AuditEvent[]` for own shares, oldest first |

Used by `secureShare.ts` only (both sides are Member 2's, so these are not part of the UI contract):

| Method | Path | Who | Success |
| --- | --- | --- | --- |
| GET | `/api/tide/admin-policy` | patient | `200` `{ policy }`: the realm's admin policy, needed to sign a share's policies. `503` until TideCloak setup is finished. |
| GET | `/api/dev/compromised/package/:id` | any (dev tools only) | `200` `ProtectedPackage` for any share. Simulates a compromised server, to show that the Tide network still refuses non-recipients. Off when `DEV_TOOLS=false`. |

Error codes:

| Code | When |
| --- | --- |
| `400` | Invalid body, for example unknown entry ids, a recipient who is not a professional, `expiresAt` in the past, or a package that does not match the share. |
| `401` | Missing or invalid token or DPoP proof. |
| `403` | Signed in but not allowed: wrong role, or not your entry or share. On `/package`: not the recipient, withdrawn, expired, or an unknown id (so ids cannot be probed). |
| `404` | No entry or share with that id. |
| `409` | Reusing a `packageId`. |
| `503` | `/api/tide/admin-policy` before TideCloak setup is finished. |

## `secureShare.ts` (in `/web/src/lib/`)

```ts
export function protectEntries(entries: Entry[], recipientId: string, expiresAt: string): Promise<ProtectedPackage>;
export function openPackage(shareId: string): Promise<Entry[]>;   // rejects if access is denied, withdrawn or expired
export function withdrawAccess(shareId: string): Promise<void>;
export function encryptEntry(entry: Omit<Entry, 'id' | 'patientId'>): Promise<EntryUpload>;
export function decryptEntries(rows: EncryptedEntry[]): Promise<Entry[]>;
```

Sharing flow in the UI:

```ts
const pkg = await protectEntries(selected, recipientId, expiresAt); // opens the Tide approval pop-up; call it straight from the click
const share = await post('/api/shares', { recipientId, entryIds: selected.map(e => e.id), expiresAt, package: pkg });
```

`protectEntries` opens a Tide pop-up, so call it directly from a click handler, or the browser may block the pop-up.

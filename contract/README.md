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
| `PUT /api/entries/:id` | The plan's table says `PUT /api/entries` without an id. |

## Calling the API

The real server needs a TideCloak token with a DPoP proof on every `/api` call. Send requests through the SDK's `secureFetch` (from `useTideCloak()`, or `IAMService.secureFetch`) with `Authorization: Bearer <token>`. The SDK swaps in `DPoP` authorisation and adds the proof. The mock API can ignore this.

JSON in and out. Every 4xx body is `{ "error": "..." }`.

## Endpoints

| Method | Path | Who | Request | Success |
| --- | --- | --- | --- | --- |
| GET | `/api/me` | any | | `200` `User` |
| GET | `/api/professionals` | patient | | `200` `User[]` (with `tideUserKey`) |
| GET | `/api/entries` | patient | | `200` `EncryptedEntry[]`, own entries, newest first |
| POST | `/api/entries` | patient | `EntryUpload` | `201` `EncryptedEntry` |
| PUT | `/api/entries/:id` | patient | `EntryUpload` | `200` `EncryptedEntry` |
| POST | `/api/shares` | patient | `CreateShareRequest` | `201` `Share` |
| GET | `/api/shares` | any | | `200` `Share[]`. Patient: shares they made. Professional: shares addressed to them. |
| GET | `/api/shares/:id/package` | professional | | `200` `ProtectedPackage` |
| POST | `/api/shares/:id/withdraw` | patient | | `200` `Share` (already withdrawn: `200`, no change) |
| GET | `/api/audit` | patient | | `200` `AuditEvent[]` for own shares, oldest first |

Error codes:

| Code | When |
| --- | --- |
| `400` | Invalid body, for example unknown entry ids, a recipient who is not a professional, `expiresAt` in the past, or a package that does not match the share. |
| `401` | Missing or invalid token or DPoP proof. |
| `403` | Signed in but not allowed: wrong role, or not your entry or share. On `/package`: not the recipient, withdrawn, or expired. |
| `404` | No entry or share with that id. |
| `409` | Withdrawing a share that has already expired. |

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

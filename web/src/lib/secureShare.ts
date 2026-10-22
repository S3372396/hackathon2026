// Secure sharing on TideCloak. Replaces Member 1's `STUB: NOT SECURE` version; the signatures are
// the ones in contract/README.md.
//
// Runs in the browser with the signed-in user's Tide session: IAMService from @tidecloak/js, which
// the app's TideCloak provider initialises. Nothing here can run on a server. Design and evidence:
// docs/tidecloak-findings.md (option A + E2).
//
// - Journal entries: title, value and notes are self-encrypted with tag "journal". Only the patient
//   who encrypted an entry can decrypt it; the server stores ciphertext.
// - Sharing: each share gets a new package id. The patient signs two policies under Tide's built-in
//   contract RelationshipAttestation:1 (one approval in the Tide enclave): the patient may write
//   that package for a few minutes, and the recipient may read it until the share expires. The
//   Tide network checks the policy on every encrypt and decrypt, so nobody else can open the
//   package, even with the ciphertext, and nobody can after expiry.
// - Withdrawal is enforced by our server: it deletes the package and refuses to serve it. A
//   recipient who saved the package before withdrawal could still open it until it expires.
import { IAMService, Models } from '@tidecloak/js';
import { PolicySignRequest } from 'heimdall-tide';
import type { EncryptedEntry, Entry, EntryUpload, ProtectedPackage, User } from '../../../contract/types';

const JOURNAL_TAG = 'journal'; // realm roles _tide_journal.selfencrypt / _tide_journal.selfdecrypt
const CONTRACT_ID = 'RelationshipAttestation:1'; // built into the ORKs; nothing is deployed
const MODEL_IDS = ['PolicyEnabledEncryption:1', 'PolicyEnabledDecryption:1'];
const WRITE_POLICY_SECONDS = 15 * 60; // the patient's own write access is only needed while sharing
const SIGN_REQUEST_EXPIRY_SECONDS = 604800; // as in Tide's relationship-attestation template
const PACKAGE_FORMAT = 1;

// Messages the contract and the network send when they refuse a request (Tide pack, scenario
// relationship-attestation). They arrive wrapped in "Could not reach enough VVK ORKs".
const REFUSAL_MARKERS = [
  'subjectId does not match', 'not found in list of roles', 'role not found', 'group not found',
  'Tags do not contain assignmentId', 'must be tagged with the assignmentId', 'expired',
];

export type SecureShareErrorCode = 'unauthenticated' | 'denied' | 'withdrawn' | 'expired' | 'not-approved' | 'failed';

/** Thrown by every function here; `code` says why, so the UI can explain it. */
export class SecureShareError extends Error {
  code: SecureShareErrorCode;
  status?: number;
  constructor(message: string, code: SecureShareErrorCode, status?: number) {
    super(message);
    this.name = 'SecureShareError';
    this.code = code;
    this.status = status;
  }
}

// --- helpers -----------------------------------------------------------------------------------

const toBase64 = (bytes: Uint8Array) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
};
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const asText = (v: string | Uint8Array) => (typeof v === 'string' ? v : new TextDecoder().decode(v));
const asCipherString = (v: string | Uint8Array) => (typeof v === 'string' ? v : toBase64(v));

/** Every message in an error, its causes and per-ORK details, for matching refusals. */
function errorText(err: unknown, depth = 0): string {
  if (err == null || depth > 5) return '';
  if (typeof err === 'string') return err;
  if (Array.isArray(err)) return err.map((e) => errorText(e, depth + 1)).join(' | ');
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>;
    return [e.message, e.detail, e.details, e.errors, e.cause].map((v) => errorText(v, depth + 1)).filter(Boolean).join(' | ');
  }
  return String(err);
}

/** A refusal by the contract or the network is not an outage: do not retry it. */
function refusalOrFailure(err: unknown, action: string): SecureShareError {
  const text = errorText(err);
  if (REFUSAL_MARKERS.some((m) => text.includes(m))) {
    const code = /expired/i.test(text) ? 'expired' : 'denied';
    return new SecureShareError(`The Tide network refused to ${action} (${code}): ${text}`, code);
  }
  return new SecureShareError(`Could not ${action}: ${text || String(err)}`, 'failed');
}

async function api<T>(path: string, { method = 'GET', body }: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!(await IAMService.getToken())) throw new SecureShareError('Not signed in.', 'unauthenticated');
  // No Authorization header: secureFetch attaches `DPoP <token>` and the proof itself. It needs an
  // absolute URL, because the proof's htu is built with `new URL(url)`.
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const url = new URL(path, window.location.origin).href;
  const res = await IAMService.secureFetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
  if (!res.ok) {
    const message = (data as { error?: string } | undefined)?.error ?? `HTTP ${res.status}`;
    const code: SecureShareErrorCode = res.status === 401 ? 'unauthenticated'
      : /withdrawn/.test(message) ? 'withdrawn' : /expired/.test(message) ? 'expired'
      : res.status === 403 ? 'denied' : 'failed';
    throw new SecureShareError(message, code, res.status);
  }
  return data as T;
}

// The part of the SDK's internal client used for policy signing. The SDK itself (and Tide's
// relationship-attestation template) uses the same object; there is no public equivalent yet.
interface TideClient {
  createTideRequest(encodedRequest: Uint8Array): Promise<Uint8Array>;
  requestTideOperatorApproval(requests: { id: string; request: Uint8Array }[]): Promise<{ id: string; request: Uint8Array; status: string }[]>;
  executeSignRequest(request: Uint8Array, waitForAll?: boolean): Promise<Uint8Array[]>;
}

function tideClient(): TideClient {
  const client = (IAMService as unknown as { _tc: TideClient | null })._tc;
  if (!client) throw new SecureShareError('TideCloak is not initialised.', 'unauthenticated');
  return client;
}

function myTideKey(): string {
  const key = IAMService.getValueFromToken('tideuserkey');
  if (typeof key !== 'string' || !key) throw new SecureShareError('Your sign-in carries no Tide key.', 'unauthenticated');
  return key;
}

/** A RelationshipAttestation:1 policy: one user, one record, one kind of access, until `expiry`. */
function buildPolicy(vendorId: string, subjectKey: string, recordId: string, role: '_tide_encryptor' | '_tide_decryptor', expiry: number) {
  const PolicyClass = Models.Policy as unknown as { latestVersion: string; new (data: unknown): InstanceType<typeof Models.Policy> };
  return new PolicyClass({
    version: PolicyClass.latestVersion, // never hard-code it
    contractId: CONTRACT_ID,
    modelId: MODEL_IDS,
    keyId: vendorId,
    approvalType: Models.ApprovalType.IMPLICIT,
    executionType: Models.ExecutionType.PRIVATE,
    // All params are strings; `roles` is JSON written as a string. Copy the key as-is.
    params: new Map<string, string>([
      ['subjectType', 'User'],
      ['subjectId', subjectKey],
      ['assignmentId', recordId],
      ['roles', JSON.stringify([role])],
    ]),
    expiry,
  });
}

/**
 * Signs policies with ONE approval in the Tide enclave (a pop-up). Only a tide-realm-admin can
 * approve, and in this prototype that is the patient. Returns the signed policies' bytes.
 */
async function signPolicies(policies: InstanceType<typeof Models.Policy>[], adminPolicy: Uint8Array): Promise<Uint8Array[]> {
  const tc = tideClient();
  const drafts: { id: string; request: Uint8Array }[] = [];
  for (const policy of policies) {
    const request = PolicySignRequest.New(policy);
    request.setCustomExpiry(SIGN_REQUEST_EXPIRY_SECONDS);
    const initialised = await tc.createTideRequest(request.encode());
    drafts.push({ id: Models.BaseTideRequest.decode(initialised).getUniqueId(), request: initialised });
  }
  let approvals: { id: string; request: Uint8Array; status: string }[];
  try {
    approvals = await tc.requestTideOperatorApproval(drafts);
  } catch (err) {
    throw new SecureShareError(`The Tide approval pop-up failed (allow pop-ups for this site): ${errorText(err)}`, 'not-approved');
  }
  const signed: Uint8Array[] = [];
  for (let i = 0; i < policies.length; i++) {
    const approval = approvals.find((a) => a.id === drafts[i].id);
    if (approval?.status !== 'approved') throw new SecureShareError(`The share was not approved (${approval?.status ?? 'no answer'}).`, 'not-approved');
    const approved = Models.BaseTideRequest.decode(approval.request);
    approved.addPolicy(adminPolicy);
    const signatures = await tc.executeSignRequest(approved.encode(), true);
    if (!signatures?.[0]) throw new SecureShareError('The Tide network returned no signature.', 'failed');
    policies[i].signature = signatures[0];
    signed.push(policies[i].toBytes());
  }
  return signed;
}

interface PackagePayload {
  format: number;
  packageId: string;
  recipientId: string;
  entries: Entry[];
}

// --- journal entries (E2) ----------------------------------------------------------------------

/** Encrypts an entry's title, value and notes in the browser. POST or PUT the result to /api/entries. */
export async function encryptEntry(entry: Omit<Entry, 'id' | 'patientId'>): Promise<EntryUpload> {
  const content = JSON.stringify({ title: entry.title, value: entry.value, notes: entry.notes });
  try {
    const [ciphertext] = await IAMService.doEncrypt([{ data: content, tags: [JOURNAL_TAG] }]);
    return { type: entry.type, loggedAt: entry.loggedAt, ciphertext: asCipherString(ciphertext) };
  } catch (err) {
    throw refusalOrFailure(err, 'encrypt the entry');
  }
}

/** Decrypts entries from GET /api/entries, in one call to the Tide network. */
export async function decryptEntries(rows: EncryptedEntry[]): Promise<Entry[]> {
  if (rows.length === 0) return [];
  let plain: (string | Uint8Array)[];
  try {
    plain = await IAMService.doDecrypt(rows.map((r) => ({ encrypted: r.ciphertext, tags: [JOURNAL_TAG] })));
  } catch (err) {
    throw refusalOrFailure(err, 'decrypt your entries');
  }
  return rows.map((row, i) => {
    const content = JSON.parse(asText(plain[i])) as Pick<Entry, 'title' | 'value' | 'notes'>;
    const entry: Entry = { id: row.id, patientId: row.patientId, type: row.type, loggedAt: row.loggedAt, title: content.title };
    if (content.value !== undefined && content.value !== null) entry.value = content.value;
    if (content.notes !== undefined && content.notes !== null) entry.notes = content.notes;
    return entry;
  });
}

// --- sharing -----------------------------------------------------------------------------------

/**
 * Encrypts `entries` so that only `recipientId` can open them, until `expiresAt`. Opens the Tide
 * approval pop-up, so call it straight from a click. Upload the result with POST /api/shares.
 */
export async function protectEntries(entries: Entry[], recipientId: string, expiresAt: string): Promise<ProtectedPackage> {
  if (entries.length === 0) throw new SecureShareError('Choose at least one entry to share.', 'failed');
  const expirySeconds = Math.floor(Date.parse(expiresAt) / 1000);
  if (!Number.isFinite(expirySeconds) || expirySeconds * 1000 <= Date.now()) throw new SecureShareError('expiresAt must be in the future.', 'failed');

  const [professionals, adminPolicy] = await Promise.all([
    api<User[]>('/api/professionals'),
    api<{ policy: string }>('/api/tide/admin-policy'),
  ]);
  const recipient = professionals.find((u) => u.id === recipientId);
  if (!recipient) throw new SecureShareError('That person is not a professional you can share with.', 'failed');
  if (!recipient.tideUserKey) throw new SecureShareError(`${recipient.name} has not signed in yet, so there is no Tide key to share with.`, 'failed');

  const vendorId = (IAMService.getConfig() as { vendorId?: string }).vendorId;
  if (!vendorId) throw new SecureShareError('The TideCloak config has no vendorId.', 'failed');
  const packageId = `pkg-${crypto.randomUUID()}`;

  const writePolicy = buildPolicy(vendorId, myTideKey(), packageId, '_tide_encryptor', Math.floor(Date.now() / 1000) + WRITE_POLICY_SECONDS);
  const readPolicy = buildPolicy(vendorId, recipient.tideUserKey, packageId, '_tide_decryptor', expirySeconds);
  const [writeBytes, readBytes] = await signPolicies([writePolicy, readPolicy], fromBase64(adminPolicy.policy));

  // Sanity check before anything leaves the browser: the read policy names exactly this recipient,
  // this package and this expiry.
  const check = Models.Policy.from(readBytes);
  if (check.params.entries.get('subjectId') !== recipient.tideUserKey || check.params.entries.get('assignmentId') !== packageId
      || check.expiry !== BigInt(expirySeconds) || !check.signature?.length) {
    throw new SecureShareError('The signed policy does not match the share.', 'failed');
  }

  const payload: PackagePayload = { format: PACKAGE_FORMAT, packageId, recipientId, entries };
  let ciphertext: string | Uint8Array;
  try {
    [ciphertext] = await IAMService.doEncrypt([{ data: JSON.stringify(payload), tags: [packageId] }], writeBytes);
  } catch (err) {
    throw refusalOrFailure(err, 'encrypt the package');
  }
  return { packageId, recipientId, expiresAt, ciphertext: asCipherString(ciphertext), recipientPolicy: toBase64(readBytes) };
}

/**
 * Fetches a share's package and decrypts it in this browser. Rejects with a SecureShareError if the
 * server refuses (not yours, withdrawn, expired) or the Tide network refuses.
 */
export async function openPackage(shareId: string): Promise<Entry[]> {
  const pkg = await api<ProtectedPackage>(`/api/shares/${encodeURIComponent(shareId)}/package`);
  return decryptPackage(pkg);
}

/** Decrypts a package that is already in hand. Exported for the enforcement checks. */
export async function decryptPackage(pkg: ProtectedPackage): Promise<Entry[]> {
  let plain: string | Uint8Array;
  try {
    [plain] = await IAMService.doDecrypt([{ encrypted: pkg.ciphertext, tags: [pkg.packageId] }], fromBase64(pkg.recipientPolicy));
  } catch (err) {
    throw refusalOrFailure(err, 'open this package');
  }
  const payload = JSON.parse(asText(plain)) as PackagePayload;
  if (payload.packageId !== pkg.packageId || payload.recipientId !== pkg.recipientId) {
    throw new SecureShareError('The package contents do not match the share.', 'failed');
  }
  return payload.entries;
}

/** Withdraws future access: the server deletes the package and stops serving it. */
export async function withdrawAccess(shareId: string): Promise<void> {
  await api(`/api/shares/${encodeURIComponent(shareId)}/withdraw`, { method: 'POST' });
}

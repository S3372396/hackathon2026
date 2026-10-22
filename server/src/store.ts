// Data access. Every function returns the contract's types (contract/types.ts).
import { randomUUID } from 'node:crypto';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import type { AuditEvent, EncryptedEntry, EntryUpload, ProtectedPackage, Role, Share, User } from '../../contract/types.ts';

type Row = Record<string, unknown>;

const opt = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : String(v));

/** Normalises any parseable date to the ISO form we store, so string comparison orders correctly. */
export const iso = (value: string | number | Date): string => new Date(value).toISOString();

// --- users -------------------------------------------------------------------------------------

export interface StoredUser extends User {
  username: string;
}

function toUser(row: Row): StoredUser {
  const user: StoredUser = { id: String(row.id), username: String(row.username), name: String(row.name), role: row.role as Role };
  if (row.profession != null) user.profession = String(row.profession);
  if (row.tide_user_key != null) user.tideUserKey = String(row.tide_user_key);
  return user;
}

/** The contract's `User`, without the internal username. */
export function publicUser({ username: _username, ...user }: StoredUser): User {
  return user;
}

export function insertUser(db: Db, user: StoredUser): void {
  db.prepare('INSERT INTO users (id, username, name, role, profession, tide_user_key) VALUES (?, ?, ?, ?, ?, ?)')
    .run(user.id, user.username, user.name, user.role, user.profession ?? null, user.tideUserKey ?? null);
}

export function getUserById(db: Db, id: string): StoredUser | undefined {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return row ? toUser(row) : undefined;
}

export function getUserByUsername(db: Db, username: string): StoredUser | undefined {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  return row ? toUser(row) : undefined;
}

export function listProfessionals(db: Db): StoredUser[] {
  return db.prepare("SELECT * FROM users WHERE role = 'professional' ORDER BY name").all().map(toUser);
}

export function setTideUserKey(db: Db, id: string, key: string): void {
  db.prepare('UPDATE users SET tide_user_key = ? WHERE id = ?').run(key, id);
}

// --- entries -----------------------------------------------------------------------------------

function toEntry(row: Row): EncryptedEntry {
  return {
    id: String(row.id),
    patientId: String(row.patient_id),
    type: row.type as EncryptedEntry['type'],
    loggedAt: String(row.logged_at),
    ciphertext: String(row.ciphertext),
  };
}

export function listEntries(db: Db, patientId: string): EncryptedEntry[] {
  return db.prepare('SELECT * FROM entries WHERE patient_id = ? ORDER BY logged_at DESC, created_at DESC').all(patientId).map(toEntry);
}

export function getEntry(db: Db, id: string): EncryptedEntry | undefined {
  const row = db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
  return row ? toEntry(row) : undefined;
}

export function insertEntry(db: Db, patientId: string, upload: EntryUpload, now: Date): EncryptedEntry {
  const id = randomUUID();
  const at = iso(now);
  db.prepare('INSERT INTO entries (id, patient_id, type, logged_at, ciphertext, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, patientId, upload.type, iso(upload.loggedAt), upload.ciphertext, at, at);
  return getEntry(db, id)!;
}

export function updateEntry(db: Db, id: string, upload: EntryUpload, now: Date): EncryptedEntry {
  db.prepare('UPDATE entries SET type = ?, logged_at = ?, ciphertext = ?, updated_at = ? WHERE id = ?')
    .run(upload.type, iso(upload.loggedAt), upload.ciphertext, iso(now), id);
  return getEntry(db, id)!;
}

// --- shares ------------------------------------------------------------------------------------

function toShare(row: Row): Share {
  const share: Share = {
    id: String(row.id),
    patientId: String(row.patient_id),
    recipientId: String(row.recipient_id),
    entryIds: JSON.parse(String(row.entry_ids)) as string[],
    expiresAt: String(row.expires_at),
    status: row.status as Share['status'],
    createdAt: String(row.created_at),
  };
  const from = opt(row.range_from);
  const to = opt(row.range_to);
  if (from) share.rangeFrom = from;
  if (to) share.rangeTo = to;
  return share;
}

export interface NewShare {
  patientId: string;
  recipientId: string;
  entryIds: string[];
  expiresAt: string;
  rangeFrom?: string;
  rangeTo?: string;
  package: ProtectedPackage;
}

export function insertShare(db: Db, share: NewShare, now: Date): Share {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO shares (id, patient_id, recipient_id, entry_ids, range_from, range_to, expires_at, status, created_at,
                         package_id, package_ciphertext, recipient_policy)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
  ).run(
    id, share.patientId, share.recipientId, JSON.stringify(share.entryIds),
    share.rangeFrom ? iso(share.rangeFrom) : null, share.rangeTo ? iso(share.rangeTo) : null,
    iso(share.expiresAt), iso(now),
    share.package.packageId, share.package.ciphertext, share.package.recipientPolicy,
  );
  return getShare(db, id)!;
}

export function getShare(db: Db, id: string): Share | undefined {
  const row = db.prepare('SELECT * FROM shares WHERE id = ?').get(id);
  return row ? toShare(row) : undefined;
}

export function packageIdExists(db: Db, packageId: string): boolean {
  return db.prepare('SELECT 1 FROM shares WHERE package_id = ?').get(packageId) !== undefined;
}

/** The stored package, or undefined once it has been deleted (withdrawn or expired). */
export function getSharePackage(db: Db, id: string): ProtectedPackage | undefined {
  const row = db.prepare('SELECT * FROM shares WHERE id = ?').get(id);
  if (!row || row.package_ciphertext == null || row.recipient_policy == null) return undefined;
  return {
    packageId: String(row.package_id),
    recipientId: String(row.recipient_id),
    expiresAt: String(row.expires_at),
    ciphertext: String(row.package_ciphertext),
    recipientPolicy: String(row.recipient_policy),
  };
}

export function listSharesByPatient(db: Db, patientId: string): Share[] {
  return db.prepare('SELECT * FROM shares WHERE patient_id = ? ORDER BY created_at DESC').all(patientId).map(toShare);
}

export function listSharesByRecipient(db: Db, recipientId: string): Share[] {
  return db.prepare('SELECT * FROM shares WHERE recipient_id = ? ORDER BY created_at DESC').all(recipientId).map(toShare);
}

/** Marks a share withdrawn and deletes its ciphertext and policy. */
export function withdrawShare(db: Db, id: string): Share {
  db.prepare("UPDATE shares SET status = 'withdrawn', package_ciphertext = NULL, recipient_policy = NULL WHERE id = ?").run(id);
  return getShare(db, id)!;
}

/**
 * Expires every active share whose expiry has passed: deletes its ciphertext and policy and records
 * an 'expired' audit event at the expiry time. Called before any request reads shares or audit.
 */
export function expireDueShares(db: Db, now: Date): Share[] {
  return transaction(db, () => {
    const due = db.prepare("SELECT * FROM shares WHERE status = 'active' AND expires_at <= ?").all(iso(now)).map(toShare);
    for (const share of due) {
      db.prepare("UPDATE shares SET status = 'expired', package_ciphertext = NULL, recipient_policy = NULL WHERE id = ?").run(share.id);
      addAudit(db, { patientId: share.patientId, shareId: share.id, action: 'expired', actorId: 'system', at: share.expiresAt });
    }
    return due.map((share) => getShare(db, share.id)!);
  });
}

// --- audit -------------------------------------------------------------------------------------

function toAudit(row: Row): AuditEvent {
  const event: AuditEvent = {
    id: String(row.id),
    patientId: String(row.patient_id),
    action: row.action as AuditEvent['action'],
    actorId: String(row.actor_id),
    at: String(row.at),
  };
  const shareId = opt(row.share_id);
  if (shareId) event.shareId = shareId;
  return event;
}

export function addAudit(db: Db, event: Omit<AuditEvent, 'id'>): AuditEvent {
  const id = randomUUID();
  db.prepare('INSERT INTO audit_events (id, patient_id, share_id, action, actor_id, at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, event.patientId, event.shareId ?? null, event.action, event.actorId, iso(event.at));
  return { ...event, id, at: iso(event.at) };
}

/** Oldest first, in the order the events were written. */
export function listAudit(db: Db, patientId: string): AuditEvent[] {
  return db.prepare('SELECT * FROM audit_events WHERE patient_id = ? ORDER BY seq').all(patientId).map(toAudit);
}

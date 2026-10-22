// Shared contract between Member 1 (UI) and Member 2 (server, secure sharing).
// Change it only with both members agreeing.
//
// STATUS: PROPOSED by Member 2 on 2026-10-23, not yet agreed with Member 1.
// Base: the plan's contract. Changes are marked NEW or CHANGED; contract/README.md explains why
// (docs/tidecloak-findings.md, options A + E2).

export type Role = 'patient' | 'professional';

export interface User {
  id: string;
  name: string;
  role: Role;
  profession?: string;           // e.g. "Physio", "GP", "Dietitian"
  tideUserKey?: string;          // NEW: the user's Tide public key, set on their first sign-in. A share policy names it.
}

// The plain entry, as the UI works with it. Only ever exists in the browser.
export interface Entry {
  id: string;
  patientId: string;
  type: 'habit' | 'mood' | 'symptom';
  title: string;
  value?: number | string;
  notes?: string;
  loggedAt: string;              // ISO date
}

// NEW: an entry as /api/entries stores and returns it. title, value and notes are encrypted in the
// patient's browser (encryptEntry / decryptEntries in secureShare.ts); the server never sees them.
export interface EncryptedEntry {
  id: string;
  patientId: string;
  type: Entry['type'];
  loggedAt: string;              // ISO date, kept in clear so entries can be filtered by date
  ciphertext: string;
}

// NEW: body of POST /api/entries and PUT /api/entries/:id. Produced by encryptEntry().
export type EntryUpload = Pick<EncryptedEntry, 'type' | 'loggedAt' | 'ciphertext'>;

export interface Share {
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

// NEW: produced by protectEntries() in the patient's browser, uploaded with POST /api/shares and
// returned by GET /api/shares/:id/package. The UI only passes it along; openPackage() decrypts it.
export interface ProtectedPackage {
  packageId: string;             // the only tag on the ciphertext, and the record id the policies name
  recipientId: string;
  expiresAt: string;
  ciphertext: string;            // the shared entries, encrypted in the patient's browser
  recipientPolicy: string;       // base64 signed Tide policy: only the recipient may decrypt, until expiresAt
}

// NEW: body of POST /api/shares. (CHANGED from the plan's { recipientId, entryIds, expiresAt }.)
export interface CreateShareRequest {
  recipientId: string;
  entryIds: string[];
  expiresAt: string;
  rangeFrom?: string;
  rangeTo?: string;
  package: ProtectedPackage;
}

export interface AuditEvent {
  id: string;
  patientId: string;
  shareId?: string;
  action: 'created' | 'viewed' | 'withdrawn' | 'expired' | 'denied';
  actorId: string;
  at: string;
}

// Error body for every 4xx response.
export interface ApiError {
  error: string;
}

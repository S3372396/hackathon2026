// Shared contract between /web (Member 1) and /server (Member 2).
// Do not change without agreeing with the other member.
// Copied from the "shared contract" section of PLAN_MEMBER_1.md; `export` added so it can be imported.

export type Role = 'patient' | 'professional';

export interface User {
  id: string;
  name: string;
  role: Role;
  profession?: string;           // e.g. "Physio", "GP", "Dietitian"
}

export interface Entry {
  id: string;
  patientId: string;
  type: 'habit' | 'mood' | 'symptom';
  title: string;
  value?: number | string;
  notes?: string;
  loggedAt: string;              // ISO date
}

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

export interface AuditEvent {
  id: string;
  patientId: string;
  shareId?: string;
  action: 'created' | 'viewed' | 'withdrawn' | 'expired' | 'denied';
  actorId: string;
  at: string;
}

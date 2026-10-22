// Shared contract between Member 1 (UI) and Member 2 (server, secure sharing).
// Copied from the plan's "The shared contract" section. Change it only with both members agreeing.

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

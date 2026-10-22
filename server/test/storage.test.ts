import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db.ts';
import { DEMO_USERS, resetAndSeed, seedIfEmpty } from '../src/seed.ts';
import * as store from '../src/store.ts';
import type { ProtectedPackage } from '../../contract/types.ts';

const NOW = new Date('2026-10-23T10:00:00.000Z');

function pkg(overrides: Partial<ProtectedPackage> = {}): ProtectedPackage {
  return {
    packageId: `pkg-${Math.random().toString(36).slice(2)}`,
    recipientId: 'physio-1',
    expiresAt: '2026-10-30T10:00:00.000Z',
    ciphertext: 'opaque-ciphertext',
    recipientPolicy: 'opaque-policy',
    ...overrides,
  };
}

function shareFor(db: Db, overrides: Partial<store.NewShare> = {}) {
  const entry = store.insertEntry(db, 'patient-1', { type: 'symptom', loggedAt: '2026-10-22', ciphertext: 'c1' }, NOW);
  const p = pkg();
  return store.insertShare(db, {
    patientId: 'patient-1', recipientId: 'physio-1', entryIds: [entry.id], expiresAt: p.expiresAt, package: p, ...overrides,
  }, NOW);
}

describe('storage', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(':memory:');
    resetAndSeed(db);
  });

  it('seeds one patient, a physio and a GP', () => {
    expect(store.getUserById(db, 'patient-1')).toMatchObject({ role: 'patient', username: 'demo.patient' });
    expect(store.listProfessionals(db).map((u) => u.profession).sort()).toEqual(['GP', 'Physio']);
    expect(DEMO_USERS).toHaveLength(3);
  });

  it('returns users in the contract shape, without the internal username', () => {
    const user = store.publicUser(store.getUserById(db, 'physio-1')!);
    expect(user).toEqual({ id: 'physio-1', name: 'Sam Demo', role: 'professional', profession: 'Physio' });
  });

  it('stores entries as ciphertext and returns EncryptedEntry objects, newest first', () => {
    store.insertEntry(db, 'patient-1', { type: 'mood', loggedAt: '2026-10-20T08:00:00Z', ciphertext: 'older' }, NOW);
    const newer = store.insertEntry(db, 'patient-1', { type: 'symptom', loggedAt: '2026-10-22T08:00:00Z', ciphertext: 'newer' }, NOW);
    expect(newer).toEqual({ id: newer.id, patientId: 'patient-1', type: 'symptom', loggedAt: '2026-10-22T08:00:00.000Z', ciphertext: 'newer' });
    expect(store.listEntries(db, 'patient-1').map((e) => e.ciphertext)).toEqual(['newer', 'older']);

    const edited = store.updateEntry(db, newer.id, { type: 'symptom', loggedAt: '2026-10-22T09:00:00Z', ciphertext: 'edited' }, NOW);
    expect(edited.ciphertext).toBe('edited');
  });

  it('stores a share with its package and deletes the package on withdrawal', () => {
    const share = shareFor(db);
    expect(share).toMatchObject({ patientId: 'patient-1', recipientId: 'physio-1', status: 'active', createdAt: NOW.toISOString() });
    expect(store.getSharePackage(db, share.id)).toMatchObject({ ciphertext: 'opaque-ciphertext', recipientPolicy: 'opaque-policy' });

    expect(store.withdrawShare(db, share.id).status).toBe('withdrawn');
    expect(store.getSharePackage(db, share.id)).toBeUndefined();
  });

  it('expires due shares, deletes their package and records the expiry at the expiry time', () => {
    const share = shareFor(db);
    expect(store.expireDueShares(db, new Date('2026-10-29T00:00:00Z'))).toHaveLength(0);

    const expired = store.expireDueShares(db, new Date('2026-10-31T00:00:00Z'));
    expect(expired.map((s) => [s.id, s.status])).toEqual([[share.id, 'expired']]);
    expect(store.getSharePackage(db, share.id)).toBeUndefined();
    expect(store.listAudit(db, 'patient-1')).toMatchObject([{ shareId: share.id, action: 'expired', actorId: 'system', at: share.expiresAt }]);
    expect(store.expireDueShares(db, new Date('2026-11-30T00:00:00Z'))).toHaveLength(0); // only once
  });

  it('lists audit events oldest first', () => {
    const share = shareFor(db);
    store.addAudit(db, { patientId: 'patient-1', shareId: share.id, action: 'created', actorId: 'patient-1', at: '2026-10-23T10:00:00Z' });
    store.addAudit(db, { patientId: 'patient-1', shareId: share.id, action: 'viewed', actorId: 'physio-1', at: '2026-10-23T11:00:00Z' });
    expect(store.listAudit(db, 'patient-1').map((e) => e.action)).toEqual(['created', 'viewed']);
  });

  it('reset clears entries, shares and audit, and keeps Tide keys by default', () => {
    store.setTideUserKey(db, 'physio-1', 'physio-key');
    const share = shareFor(db);
    store.addAudit(db, { patientId: 'patient-1', shareId: share.id, action: 'created', actorId: 'patient-1', at: NOW.toISOString() });

    resetAndSeed(db);
    expect(store.listEntries(db, 'patient-1')).toEqual([]);
    expect(store.listSharesByPatient(db, 'patient-1')).toEqual([]);
    expect(store.listAudit(db, 'patient-1')).toEqual([]);
    expect(store.getUserById(db, 'physio-1')?.tideUserKey).toBe('physio-key');

    resetAndSeed(db, { keepTideKeys: false });
    expect(store.getUserById(db, 'physio-1')?.tideUserKey).toBeUndefined();
  });

  it('seedIfEmpty seeds only an empty database', () => {
    const fresh = openDb(':memory:');
    expect(seedIfEmpty(fresh)).toBe(true);
    expect(seedIfEmpty(fresh)).toBe(false);
    expect(store.listProfessionals(fresh)).toHaveLength(2);
  });
});

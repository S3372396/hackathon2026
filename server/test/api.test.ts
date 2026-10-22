// Contract tests: every endpoint in contract/README.md, with its response shape and status codes.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as store from '../src/store.ts';
import { DAY, startTestApp, type TestApp } from './helpers.ts';

const USER_KEYS = ['id', 'name', 'role'];
const SHARE_KEYS = ['createdAt', 'entryIds', 'expiresAt', 'id', 'patientId', 'recipientId', 'status'];
const PACKAGE_KEYS = ['ciphertext', 'expiresAt', 'packageId', 'recipientId', 'recipientPolicy'];
const ENTRY_KEYS = ['ciphertext', 'id', 'loggedAt', 'patientId', 'type'];
const AUDIT_KEYS = ['action', 'actorId', 'at', 'id', 'patientId', 'shareId'];
const keys = (o: object) => Object.keys(o).sort();

let t: TestApp;
beforeEach(async () => {
  t = await startTestApp();
});
afterEach(() => t.close());

describe('authentication', () => {
  const endpoints: [string, string][] = [
    ['GET', '/api/me'], ['GET', '/api/professionals'], ['GET', '/api/entries'], ['POST', '/api/entries'],
    ['PUT', '/api/entries/x'], ['POST', '/api/shares'], ['GET', '/api/shares'], ['GET', '/api/shares/x/package'],
    ['POST', '/api/shares/x/withdraw'], ['GET', '/api/audit'],
  ];

  it('refuses every endpoint without a verified sign-in (401)', async () => {
    for (const [method, path] of endpoints) {
      const res = await t.call(null, method, path, method === 'GET' ? undefined : {});
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(res.body).toEqual({ error: 'sign in required' });
    }
  });

  it('refuses a verified user who is not in the app (403)', async () => {
    t.principals.set('stranger', { username: 'someone.else', roles: ['patient'] });
    expect((await t.call('stranger', 'GET', '/api/me')).status).toBe(403);
  });

  it('takes the role from the server, not from what the token claims alone', async () => {
    // A professional whose token claims "patient" gets neither the patient's powers nor in at all.
    t.principals.set('fake-patient', { username: 'demo.gp', roles: ['patient'] });
    const res = await t.call('fake-patient', 'GET', '/api/entries');
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('professional');
  });
});

describe('GET /api/me', () => {
  it('returns the caller as a contract User and records their Tide key', async () => {
    const res = await t.call('physio', 'GET', '/api/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'physio-1', name: 'Sam Demo', role: 'professional', profession: 'Physio', tideUserKey: 'key-physio' });
    expect(store.getUserById(t.db, 'physio-1')?.tideUserKey).toBe('key-physio');
  });
});

describe('GET /api/professionals', () => {
  it('lists professionals, with Tide keys once they have signed in, for a patient', async () => {
    await t.signInAll();
    const res = await t.call('patient', 'GET', '/api/professionals');
    expect(res.status).toBe(200);
    expect(res.body.map((u: { id: string }) => u.id).sort()).toEqual(['gp-1', 'physio-1']);
    for (const u of res.body) expect(keys(u)).toEqual([...USER_KEYS, 'profession', 'tideUserKey'].sort());
  });

  it('is patient-only (403 for a professional)', async () => {
    expect((await t.call('gp', 'GET', '/api/professionals')).status).toBe(403);
  });
});

describe('/api/entries', () => {
  it('creates (201), lists newest first (200) and edits (200) encrypted entries', async () => {
    const older = await t.addEntry('mood', 3);
    const created = await t.addEntry('symptom', 1);
    expect(keys(created)).toEqual(ENTRY_KEYS);
    expect(created.patientId).toBe('patient-1');

    const list = await t.call('patient', 'GET', '/api/entries');
    expect(list.status).toBe(200);
    expect(list.body.map((e: { id: string }) => e.id)).toEqual([created.id, older.id]);

    const edited = await t.call('patient', 'PUT', `/api/entries/${created.id}`, { type: 'symptom', loggedAt: created.loggedAt, ciphertext: 'edited' });
    expect(edited.status).toBe(200);
    expect(edited.body).toEqual({ ...created, ciphertext: 'edited' });
  });

  it('rejects plaintext and invalid bodies (400)', async () => {
    const good = { type: 'mood', loggedAt: '2026-10-22T08:00:00Z', ciphertext: 'c' };
    for (const body of [
      { ...good, title: 'Headache' },            // plaintext must never reach the server
      { ...good, notes: 'slept badly' },
      { ...good, type: 'diet' },
      { ...good, loggedAt: 'yesterday' },
      { ...good, ciphertext: '' },
      [good],
    ]) {
      const res = await t.call('patient', 'POST', '/api/entries', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await t.call('patient', 'GET', '/api/entries')).body).toEqual([]);
  });

  it('returns 404 for an unknown entry and 403 for another patient\'s entry', async () => {
    store.insertUser(t.db, { id: 'patient-2', username: 'other.patient', name: 'Other Demo', role: 'patient' });
    t.principals.set('other', { username: 'other.patient', roles: ['patient'] });
    const mine = await t.addEntry('mood', 0);
    const body = { type: 'mood', loggedAt: mine.loggedAt, ciphertext: 'x' };
    expect((await t.call('patient', 'PUT', '/api/entries/nope', body)).status).toBe(404);
    expect((await t.call('other', 'PUT', `/api/entries/${mine.id}`, body)).status).toBe(403);
    expect((await t.call('other', 'GET', '/api/entries')).body).toEqual([]);
  });

  it('is patient-only (403 for professionals)', async () => {
    expect((await t.call('physio', 'GET', '/api/entries')).status).toBe(403);
    expect((await t.call('physio', 'POST', '/api/entries', { type: 'mood', loggedAt: '2026-10-22', ciphertext: 'c' })).status).toBe(403);
  });
});

describe('POST /api/shares', () => {
  it('creates a share (201) in the contract shape and audits it', async () => {
    const entry = await t.addEntry('symptom', 1);
    const res = await t.call('patient', 'POST', '/api/shares', { ...t.shareRequest([entry.id]), rangeFrom: '2026-10-16T00:00:00Z', rangeTo: '2026-10-23T00:00:00Z' });
    expect(res.status).toBe(201);
    expect(keys(res.body)).toEqual([...SHARE_KEYS, 'rangeFrom', 'rangeTo'].sort());
    expect(res.body).toMatchObject({ patientId: 'patient-1', recipientId: 'physio-1', entryIds: [entry.id], status: 'active', createdAt: t.clock.now.toISOString() });

    const audit = await t.call('patient', 'GET', '/api/audit');
    expect(audit.body).toMatchObject([{ action: 'created', shareId: res.body.id, actorId: 'patient-1' }]);
  });

  it('rejects invalid shares (400)', async () => {
    store.insertUser(t.db, { id: 'patient-2', username: 'other.patient', name: 'Other Demo', role: 'patient' });
    t.principals.set('other', { username: 'other.patient', roles: ['patient'] });
    const mine = await t.addEntry('symptom', 1);
    const theirs = (await t.call('other', 'POST', '/api/entries', { type: 'mood', loggedAt: '2026-10-22', ciphertext: 'c' })).body;
    const ok = t.shareRequest([mine.id]);
    const cases: [string, unknown][] = [
      ['unknown recipient', { ...ok, recipientId: 'nobody' }],
      ['recipient is not a professional', { ...ok, recipientId: 'patient-2', package: { ...ok.package, recipientId: 'patient-2' } }],
      ['no entries', { ...ok, entryIds: [] }],
      ['unknown entry', { ...ok, entryIds: ['nope'] }],
      ["another patient's entry", { ...ok, entryIds: [theirs.id] }],
      ['duplicate entries', { ...ok, entryIds: [mine.id, mine.id] }],
      ['expiry in the past', { ...ok, expiresAt: new Date(t.clock.now.getTime() - DAY).toISOString() }],
      ['no package', { ...ok, package: undefined }],
      ['package for someone else', { ...ok, package: { ...ok.package, recipientId: 'gp-1' } }],
      ['package with another expiry', { ...ok, package: { ...ok.package, expiresAt: new Date(t.clock.now.getTime() + 30 * DAY).toISOString() } }],
      ['package without ciphertext', { ...ok, package: { ...ok.package, ciphertext: '' } }],
      ['range backwards', { ...ok, rangeFrom: '2026-10-23T00:00:00Z', rangeTo: '2026-10-16T00:00:00Z' }],
    ];
    for (const [name, body] of cases) {
      expect((await t.call('patient', 'POST', '/api/shares', body)).status, name).toBe(400);
    }
    expect((await t.call('patient', 'GET', '/api/shares')).body).toEqual([]);
  });

  it('refuses a reused packageId (409) and professionals (403)', async () => {
    const entry = await t.addEntry('symptom', 1);
    await t.addShare([entry.id], { packageId: 'pkg-1' });
    expect((await t.call('patient', 'POST', '/api/shares', t.shareRequest([entry.id], { packageId: 'pkg-1' }))).status).toBe(409);
    expect((await t.call('physio', 'POST', '/api/shares', t.shareRequest([entry.id]))).status).toBe(403);
  });
});

describe('GET /api/shares', () => {
  it('shows a patient the shares they made and a professional only the shares addressed to them', async () => {
    const entry = await t.addEntry('symptom', 1);
    const toPhysio = await t.addShare([entry.id]);
    const toGp = await t.addShare([entry.id], { recipientId: 'gp-1' });

    const mine = await t.call('patient', 'GET', '/api/shares');
    expect(mine.body.map((s: { id: string }) => s.id).sort()).toEqual([toPhysio.id, toGp.id].sort());
    const physio = await t.call('physio', 'GET', '/api/shares');
    expect(physio.body).toEqual([toPhysio]);
    for (const s of physio.body) expect(keys(s)).toEqual(SHARE_KEYS);
  });
});

describe('GET /api/shares/:id/package', () => {
  it('returns the ProtectedPackage to the recipient (200) and audits the view', async () => {
    const entry = await t.addEntry('symptom', 1);
    const share = await t.addShare([entry.id]);
    const res = await t.call('physio', 'GET', `/api/shares/${share.id}/package`);
    expect(res.status).toBe(200);
    expect(keys(res.body)).toEqual(PACKAGE_KEYS);
    expect(res.body).toMatchObject({ recipientId: 'physio-1', ciphertext: 'package-for-physio-1', expiresAt: share.expiresAt });
    expect((await t.call('patient', 'GET', '/api/audit')).body.map((e: { action: string }) => e.action)).toEqual(['created', 'viewed']);
  });

  it('refuses the wrong professional and the patient (403), audits it, and 404s an unknown share', async () => {
    const entry = await t.addEntry('symptom', 1);
    const share = await t.addShare([entry.id]);
    expect((await t.call('gp', 'GET', `/api/shares/${share.id}/package`)).status).toBe(403);
    expect((await t.call('patient', 'GET', `/api/shares/${share.id}/package`)).status).toBe(403);
    expect((await t.call('gp', 'GET', '/api/shares/nope/package')).status).toBe(404);
    const audit = (await t.call('patient', 'GET', '/api/audit')).body;
    expect(audit.map((e: { action: string; actorId: string }) => [e.action, e.actorId])).toEqual([
      ['created', 'patient-1'], ['denied', 'gp-1'], ['denied', 'patient-1'],
    ]);
  });
});

describe('POST /api/shares/:id/withdraw', () => {
  it('withdraws (200), is repeatable (200, no new event) and stops the package (403)', async () => {
    const entry = await t.addEntry('symptom', 1);
    const share = await t.addShare([entry.id]);
    const res = await t.call('patient', 'POST', `/api/shares/${share.id}/withdraw`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...share, status: 'withdrawn' });
    expect((await t.call('patient', 'POST', `/api/shares/${share.id}/withdraw`)).status).toBe(200);
    expect((await t.call('physio', 'GET', `/api/shares/${share.id}/package`)).status).toBe(403);
    const actions = (await t.call('patient', 'GET', '/api/audit')).body.map((e: { action: string }) => e.action);
    expect(actions).toEqual(['created', 'withdrawn', 'denied']);
  });

  it('refuses anyone but the patient who made it (403, audited), 404s an unknown share, 409s an expired one', async () => {
    const entry = await t.addEntry('symptom', 1);
    const share = await t.addShare([entry.id], { days: 1 });
    expect((await t.call('physio', 'POST', `/api/shares/${share.id}/withdraw`)).status).toBe(403);
    expect((await t.call('patient', 'POST', '/api/shares/nope/withdraw')).status).toBe(404);
    t.clock.now = new Date(t.clock.now.getTime() + 2 * DAY);
    expect((await t.call('patient', 'POST', `/api/shares/${share.id}/withdraw`)).status).toBe(409);
    const actions = (await t.call('patient', 'GET', '/api/audit')).body.map((e: { action: string }) => e.action);
    expect(actions).toEqual(['created', 'denied', 'expired']);
  });
});

describe('expiry', () => {
  it('marks a share expired when its time passes, and the package is refused (403)', async () => {
    const entry = await t.addEntry('symptom', 1);
    const share = await t.addShare([entry.id], { days: 7 });
    t.clock.now = new Date(Date.parse(share.expiresAt) + 1000);
    expect((await t.call('physio', 'GET', '/api/shares')).body).toMatchObject([{ id: share.id, status: 'expired' }]);
    expect((await t.call('physio', 'GET', `/api/shares/${share.id}/package`)).status).toBe(403);
  });
});

describe('GET /api/audit', () => {
  it('returns contract AuditEvents to the patient, oldest first; professionals get 403', async () => {
    const entry = await t.addEntry('symptom', 1);
    await t.addShare([entry.id]);
    const res = await t.call('patient', 'GET', '/api/audit');
    expect(res.status).toBe(200);
    for (const e of res.body) expect(keys(e)).toEqual(AUDIT_KEYS);
    expect((await t.call('physio', 'GET', '/api/audit')).status).toBe(403);
  });
});

describe('HTTP details', () => {
  it('answers unknown /api paths with 404 JSON', async () => {
    const res = await t.call('patient', 'GET', '/api/nothing-here');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'no such endpoint' });
  });

  it('answers invalid JSON with 400', async () => {
    const res = await fetch(`${t.base}/api/entries`, { method: 'POST', headers: { authorization: 'Test patient', 'content-type': 'application/json' }, body: '{nope' });
    expect(res.status).toBe(400);
  });

  it('allows CORS preflight from the web app origin only', async () => {
    const preflight = (origin: string) => fetch(`${t.base}/api/me`, {
      method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization,dpop' },
    });
    const ok = await preflight('http://localhost:5173');
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(ok.headers.get('access-control-allow-headers')).toContain('DPoP');
    const other = await preflight('https://evil.example');
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });
});

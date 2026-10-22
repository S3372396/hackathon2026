// Test harness: the real app on a random port, an in-memory database, a clock the test controls,
// and a test-only authenticator. The fake authenticator exists only here, never in src/.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp, type Authenticate, type Principal } from '../src/app.ts';
import { openDb } from '../src/db.ts';
import { resetAndSeed } from '../src/seed.ts';
import type { CreateShareRequest, EncryptedEntry, ProtectedPackage, Share } from '../../contract/types.ts';

export const START = new Date('2026-10-23T10:00:00.000Z');
export const DAY = 24 * 60 * 60 * 1000;

export const PRINCIPALS: Record<string, Principal> = {
  patient: { username: 'demo.patient', roles: ['patient'], tideUserKey: 'key-patient' },
  physio: { username: 'demo.physio', roles: ['professional'], tideUserKey: 'key-physio' },
  gp: { username: 'demo.gp', roles: ['professional'], tideUserKey: 'key-gp' },
};

/** `Authorization: Test <name>` resolves to the principal registered under that name. */
function fakeAuth(principals: Map<string, Principal>): Authenticate {
  return async (req) => {
    const match = /^Test (\S+)$/.exec(req.headers.authorization ?? '');
    return (match && principals.get(match[1])) || null;
  };
}

export interface Reply<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

export async function startTestApp() {
  const db = openDb(':memory:');
  resetAndSeed(db);
  const principals = new Map(Object.entries(PRINCIPALS));
  const clock = { now: START };
  const app = createApp({ db, authenticate: fakeAuth(principals), now: () => clock.now, webOrigin: 'http://localhost:5173' });
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function call<T = any>(as: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply<T>> {
    const h: Record<string, string> = { ...headers };
    if (as) h.authorization = `Test ${as}`;
    if (body !== undefined) h['content-type'] = 'application/json';
    const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined, headers: res.headers };
  }

  /** Signs every demo user in once, so the server records their Tide keys. */
  async function signInAll() {
    for (const name of Object.keys(PRINCIPALS)) await call(name, 'GET', '/api/me');
  }

  async function addEntry(type: EncryptedEntry['type'], daysAgo: number, ciphertext = `cipher-${type}-${daysAgo}`) {
    const loggedAt = new Date(clock.now.getTime() - daysAgo * DAY).toISOString();
    const res = await call<EncryptedEntry>('patient', 'POST', '/api/entries', { type, loggedAt, ciphertext });
    if (res.status !== 201) throw new Error(`addEntry failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }

  function shareRequest(entryIds: string[], { recipientId = 'physio-1', days = 7, packageId = `pkg-${crypto.randomUUID()}` } = {}): CreateShareRequest {
    const expiresAt = new Date(clock.now.getTime() + days * DAY).toISOString();
    const pkg: ProtectedPackage = { packageId, recipientId, expiresAt, ciphertext: `package-for-${recipientId}`, recipientPolicy: `policy-for-${recipientId}` };
    return { recipientId, entryIds, expiresAt, package: pkg };
  }

  async function addShare(entryIds: string[], options: Parameters<typeof shareRequest>[1] = {}) {
    const res = await call<Share>('patient', 'POST', '/api/shares', shareRequest(entryIds, options));
    if (res.status !== 201) throw new Error(`addShare failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }

  const close = () => new Promise<void>((resolve) => server.close(() => resolve()));

  return { db, principals, clock, base, call, signInAll, addEntry, shareRequest, addShare, close };
}

export type TestApp = Awaited<ReturnType<typeof startTestApp>>;

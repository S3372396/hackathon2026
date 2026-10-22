// The TideCloak token + DPoP verifier, against the checklist in Tide's verify-jwt-server-side
// playbook. A locally generated Ed25519 key stands in for the realm's key, and an ES256 key for the
// browser's DPoP key, so these run without a TideCloak.
import { createHash, generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type Authenticate } from '../src/app.ts';
import { AuthError, createTideVerifier, jwkThumbprint, tideAuthenticator, type TideAdapterConfig } from '../src/auth/tide.ts';
import { openDb } from '../src/db.ts';
import { resetAndSeed } from '../src/seed.ts';

const NOW = new Date('2026-10-23T10:00:00.000Z');
const T = Math.floor(NOW.getTime() / 1000);
const ORIGIN = 'http://localhost:3001';

const realm = generateKeyPairSync('ed25519');
const otherRealm = generateKeyPairSync('ed25519');
const dpop = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const otherDpop = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const dpopEd = generateKeyPairSync('ed25519');

const publicJwk = (k: KeyObject) => k.export({ format: 'jwk' });
const adapter: TideAdapterConfig = {
  realm: 'health-journal',
  'auth-server-url': 'http://localhost:8080',
  resource: 'health-journal-web',
  jwk: { keys: [{ ...publicJwk(realm.publicKey), kid: 'realm-key', alg: 'EdDSA', use: 'sig' }] },
};

function jws(header: object, payload: object, key: KeyObject, alg: 'EdDSA' | 'ES256'): string {
  const input = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  const sig = alg === 'EdDSA' ? sign(null, Buffer.from(input), key) : sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
  return `${input}.${sig.toString('base64url')}`;
}

function accessToken(claims: Record<string, unknown> = {}, key = realm.privateKey, jkt = jwkThumbprint(publicJwk(dpop.publicKey))) {
  return jws({ alg: 'EdDSA', typ: 'JWT', kid: 'realm-key' }, {
    iss: 'http://localhost:8080/realms/health-journal', azp: 'health-journal-web', exp: T + 600, iat: T,
    preferred_username: 'demo.physio', realm_access: { roles: ['professional', '_tide_decryptor'] }, tideuserkey: 'key-physio',
    cnf: { jkt }, ...claims,
  }, key, 'EdDSA');
}

interface ProofOptions { method?: string; url?: string; token?: string; iat?: number; jti?: string; key?: KeyObject; jwk?: object; typ?: string; alg?: 'ES256' | 'EdDSA' }
function proof(token: string, o: ProofOptions = {}) {
  const alg = o.alg ?? 'ES256';
  const key = o.key ?? (alg === 'EdDSA' ? dpopEd.privateKey : dpop.privateKey);
  const jwk = o.jwk ?? publicJwk(alg === 'EdDSA' ? dpopEd.publicKey : dpop.publicKey);
  return jws({ typ: o.typ ?? 'dpop+jwt', alg, jwk }, {
    jti: o.jti ?? randomUUID(), htm: o.method ?? 'GET', htu: o.url ?? `${ORIGIN}/api/me`, iat: o.iat ?? T,
    ath: createHash('sha256').update(o.token ?? token).digest('base64url'),
  }, key, alg);
}

const verifier = () => createTideVerifier({ adapter, publicOrigins: [ORIGIN, 'http://localhost:5173'], now: () => NOW });
const request = (token: string, dpopProof?: string, scheme = 'DPoP', method = 'GET', path = '/api/me') =>
  ({ method, path, authorization: `${scheme} ${token}`, dpop: dpopProof });

describe('TideCloak verifier: accepts', () => {
  it('a realm-signed, DPoP-bound token with a valid proof, and maps it to a principal', () => {
    const token = accessToken();
    expect(verifier().verifyRequest(request(token, proof(token)))).toEqual({
      username: 'demo.physio', roles: ['professional', '_tide_decryptor'], tideUserKey: 'key-physio',
    });
  });

  it('an EdDSA proof, and a proof made for the web app origin (dev proxy)', () => {
    const edToken = accessToken({}, realm.privateKey, jwkThumbprint(publicJwk(dpopEd.publicKey)));
    expect(verifier().verifyRequest(request(edToken, proof(edToken, { alg: 'EdDSA' }))).username).toBe('demo.physio');
    const token = accessToken();
    expect(verifier().verifyRequest(request(token, proof(token, { url: 'http://localhost:5173/api/me' }))).username).toBe('demo.physio');
  });
});

describe('TideCloak verifier: rejects', () => {
  const cases: [string, () => ReturnType<typeof request>][] = [
    ['an expired token', () => { const t = accessToken({ exp: T - 3600 }); return request(t, proof(t)); }],
    ['a malformed token', () => request('not.a.token', proof('not.a.token'))],
    ['a token signed by another key', () => { const t = accessToken({}, otherRealm.privateKey); return request(t, proof(t)); }],
    ['a token with alg none', () => {
      const t = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${accessToken().split('.')[1]}.`;
      return request(t, proof(t));
    }],
    ['a token from another issuer', () => { const t = accessToken({ iss: 'http://localhost:8080/realms/other' }); return request(t, proof(t)); }],
    ['a token for another client', () => { const t = accessToken({ azp: 'other-client' }); return request(t, proof(t)); }],
    ['a token issued in the future', () => { const t = accessToken({ iat: T + 3600 }); return request(t, proof(t)); }],
    ['a bound token replayed as Bearer', () => { const t = accessToken(); return request(t, proof(t), 'Bearer'); }],
    ['a bound token without a proof', () => request(accessToken())],
    ['an unbound token (no cnf.jkt)', () => { const t = accessToken({ cnf: undefined }); return request(t, proof(t)); }],
    ['a proof signed by a key other than its jwk', () => { const t = accessToken(); return request(t, proof(t, { key: otherDpop.privateKey })); }],
    ['a proof whose key is not the bound key', () => {
      const t = accessToken();
      return request(t, proof(t, { key: otherDpop.privateKey, jwk: publicJwk(otherDpop.publicKey) }));
    }],
    ['a proof for another token (ath)', () => { const t = accessToken(); return request(t, proof(t, { token: accessToken({ jti: 'x' }) })); }],
    ['a proof for another method (htm)', () => { const t = accessToken(); return request(t, proof(t, { method: 'POST' })); }],
    ['a proof for another path (htu)', () => { const t = accessToken(); return request(t, proof(t, { url: `${ORIGIN}/api/audit` })); }],
    ['a proof for another origin (htu)', () => { const t = accessToken(); return request(t, proof(t, { url: 'https://evil.example/api/me' })); }],
    ['a stale proof (iat)', () => { const t = accessToken(); return request(t, proof(t, { iat: T - 3600 })); }],
    ['a proof with the wrong typ', () => { const t = accessToken(); return request(t, proof(t, { typ: 'JWT' })); }],
    ['a proof carrying a private key', () => {
      const t = accessToken();
      return request(t, proof(t, { jwk: dpop.privateKey.export({ format: 'jwk' }) }));
    }],
  ];
  for (const [name, make] of cases) {
    it(name, () => {
      expect(() => verifier().verifyRequest(make())).toThrow(AuthError);
    });
  }

  it('a replayed proof (same jti)', () => {
    const v = verifier();
    const token = accessToken();
    const p = proof(token);
    expect(v.verifyRequest(request(token, p)).username).toBe('demo.physio');
    expect(() => v.verifyRequest(request(token, p))).toThrow(/replayed/);
  });

  it('an adapter config without an embedded jwk (no remote key fetching)', () => {
    expect(() => createTideVerifier({ adapter: { ...adapter, jwk: { keys: [] } }, publicOrigins: [ORIGIN] })).toThrow(/jwk/);
  });
});

describe('TideCloak verifier wired into the API', () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    const db = openDb(':memory:');
    resetAndSeed(db);
    let authenticate: Authenticate = async () => null;
    const app = createApp({ db, authenticate: (req) => authenticate(req), wwwAuthenticate: 'DPoP algs="ES256 EdDSA"' });
    server = await new Promise<Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    authenticate = tideAuthenticator({ adapter, publicOrigins: [base] });
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('signs in with a real token and proof, and refuses a Bearer replay with a DPoP challenge', async () => {
    const token = accessToken({ exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000) });
    const fresh = () => proof(token, { url: `${base}/api/me`, iat: Math.floor(Date.now() / 1000) });
    const ok = await fetch(`${base}/api/me`, { headers: { authorization: `DPoP ${token}`, dpop: fresh() } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ id: 'physio-1', role: 'professional', tideUserKey: 'key-physio' });

    const replay = await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${token}` } });
    expect(replay.status).toBe(401);
    expect(replay.headers.get('www-authenticate')).toBe('DPoP algs="ES256 EdDSA"');
  });

  it('enforces the role on the server: a professional cannot list professionals or entries', async () => {
    const token = accessToken({ exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000) });
    for (const path of ['/api/professionals', '/api/entries', '/api/audit']) {
      const res = await fetch(`${base}${path}`, {
        headers: { authorization: `DPoP ${token}`, dpop: proof(token, { url: `${base}${path}`, iat: Math.floor(Date.now() / 1000) }) },
      });
      expect(res.status, path).toBe(403);
    }
  });
});

// The Tide browser prerequisites served by the server, read off the wire as the pack advises.
import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';
import { mountTidePages, type TidePagesOptions } from '../src/web.ts';

const serverDir = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const KNOWN_GOOD_RELAY_SHA256 = '9d7844b938f0a2565fa910d3d30e9b8797cbfd6e0b73d59d804169a089aea757'; // Tide pack, tide_dpop_asset
const adapter = { realm: 'health-journal', 'auth-server-url': 'http://localhost:8080', resource: 'health-journal-web', jwk: { keys: [] } };
const hex = (s: string) => Buffer.from(s).toString('hex');
const relayPath = (iss: string, aud: string) => `/tide_dpop/iss/${hex(iss)}/aud/${hex(aud)}/tide_dpop_auth.html`;

async function start(options: Partial<TidePagesOptions>) {
  const app = createApp({
    db: openDb(':memory:'), authenticate: async () => null,
    mount: (a) => mountTidePages(a, { adapter: adapter as never, devTools: true, serverDir, repoRoot, ...options }),
  });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

describe('Tide browser pages', () => {
  let server: Server;
  let base: string;
  beforeAll(async () => ({ server, base } = await start({})));
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('serves the DPoP relay byte-exact, with its own CSP and Allow-CSP-From', async () => {
    const res = await fetch(base + relayPath('http://localhost:8080/realms/health-journal', 'health-journal-web') + '?version=1&openerOrigin=x');
    expect(res.status).toBe(200);
    expect(res.headers.get('allow-csp-from')).toBe('*');
    expect(res.headers.get('content-security-policy')).toMatch(/^default-src 'self'; script-src 'self' 'sha256-/);
    const body = Buffer.from(await res.arrayBuffer());
    expect(createHash('sha256').update(body).digest('hex')).toBe(KNOWN_GOOD_RELAY_SHA256);
  });

  it('refuses the relay for another realm or client', async () => {
    expect((await fetch(base + relayPath('http://localhost:8080/realms/other', 'health-journal-web'))).status).toBe(403);
    expect((await fetch(base + relayPath('http://localhost:8080/realms/health-journal', 'other-client'))).status).toBe(403);
  });

  it('serves silent-check-sso.html and the public adapter config', async () => {
    const sso = await fetch(`${base}/silent-check-sso.html`);
    expect(sso.status).toBe(200);
    expect(await sso.text()).toContain('postMessage');
    expect(await (await fetch(`${base}/tidecloak.json`)).json()).toMatchObject({ realm: 'health-journal' });
  });

  it('serves the dev page with a frame-src policy for the enclave, and no frame-ancestors', async () => {
    for (const path of ['/dev/', '/auth/redirect']) {
      const res = await fetch(base + path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-security-policy')).toBe("frame-src 'self' *");
      expect(await res.text()).toContain('importmap');
    }
  });

  it('redirects the SDK\'s extensionless imports to real files, and serves only the SDK packages', async () => {
    const dir = await fetch(`${base}/vendor/@tideorg/js/dist/Clients`, { redirect: 'manual' });
    expect(dir.status).toBe(302);
    expect(dir.headers.get('location')).toBe('/vendor/@tideorg/js/dist/Clients/index.js');
    const entry = await fetch(`${base}/vendor/@tidecloak/js/dist/esm/src/index.js`);
    expect(entry.status).toBe(200);
    expect(entry.headers.get('content-type')).toMatch(/javascript/);
    expect((await fetch(`${base}/vendor/express/package.json`)).status).toBe(404);
    expect((await fetch(`${base}/vendor/@tideorg/js/../../express/package.json`)).status).toBe(404);
  });
});

describe('without an adapter, and with dev tools off', () => {
  it('404s the adapter config and every dev route', async () => {
    const { server, base } = await start({ adapter: undefined, devTools: false });
    try {
      expect((await fetch(`${base}/tidecloak.json`)).status).toBe(404);
      for (const path of ['/dev/', '/auth/redirect', '/vendor/@tidecloak/js/dist/esm/src/index.js', '/web-lib/secureShare.js']) {
        expect((await fetch(base + path)).status, path).toBe(404);
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

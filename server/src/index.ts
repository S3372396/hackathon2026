import { existsSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { config, repoRoot, serverDir } from './config.ts';
import { openDb } from './db.ts';
import { seedIfEmpty } from './seed.ts';
import { createApp, type Authenticate } from './app.ts';
import { tideAuthenticator, type TideAdapterConfig } from './auth/tide.ts';
import { mountTidePages } from './web.ts';

const db = openDb(config.dbPath);
if (seedIfEmpty(db)) console.log('Seeded the demo users into an empty database.');

const adapter: TideAdapterConfig | undefined = existsSync(config.adapterPath)
  ? JSON.parse(readFileSync(config.adapterPath, 'utf8'))
  : undefined;

// Without the exported adapter there is no realm key to check tokens against, so every /api call
// is refused (401): the API fails closed.
let authenticate: Authenticate = async () => null;
if (adapter) {
  authenticate = tideAuthenticator({ adapter, publicOrigins: config.publicOrigins }, (msg) => console.warn(msg));
} else {
  console.warn(`No TideCloak adapter at ${config.adapterPath}: every /api call is refused until tidecloak/setup.sh phase2 exports it.`);
}

const app = createApp({
  db,
  authenticate,
  webOrigin: config.webOrigin,
  wwwAuthenticate: 'DPoP algs="ES256 EdDSA"',
  mount: (a) => mountTidePages(a, { adapter, devTools: config.devTools, serverDir, repoRoot }),
});

const server = app.listen(config.port, () => {
  const { port } = server.address() as AddressInfo;
  console.log(`Health journal API on http://localhost:${port} (database: ${config.dbPath})`);
  if (config.devTools) console.log(`Dev check page: http://localhost:${port}/dev/ (DEV_TOOLS=false to turn off)`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
}

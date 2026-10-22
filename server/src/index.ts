import type { AddressInfo } from 'node:net';
import { config } from './config.ts';
import { openDb } from './db.ts';
import { seedIfEmpty } from './seed.ts';
import { createApp } from './app.ts';

const db = openDb(config.dbPath);
if (seedIfEmpty(db)) console.log('Seeded the demo users into an empty database.');

// Until TideCloak sign-in is wired up (Task 4), every /api call is refused with 401.
const server = createApp({ db, authenticate: async () => null }).listen(config.port, () => {
  const { port } = server.address() as AddressInfo;
  console.log(`Health journal API on http://localhost:${port} (database: ${config.dbPath})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
}

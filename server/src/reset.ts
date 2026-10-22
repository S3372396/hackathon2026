// npm run reset                        clear entries, shares and audit; re-seed the demo users
// npm run reset -- --forget-tide-keys  also forget the Tide keys recorded at sign-in
import { config } from './config.ts';
import { openDb } from './db.ts';
import { resetAndSeed } from './seed.ts';

const keepTideKeys = !process.argv.includes('--forget-tide-keys');
const db = openDb(config.dbPath);
resetAndSeed(db, { keepTideKeys });

const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const keys = (db.prepare('SELECT COUNT(*) AS n FROM users WHERE tide_user_key IS NOT NULL').get() as { n: number }).n;
console.log(`Reset ${config.dbPath}`);
console.log(`  users: ${count('users')} (${keys} with a Tide key), entries: ${count('entries')}, shares: ${count('shares')}, audit events: ${count('audit_events')}`);
db.close();

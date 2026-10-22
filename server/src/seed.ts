// Fake demo data only. Usernames must match the TideCloak users created by tidecloak/setup.sh.
//
// Journal entries are not seeded: they are encrypted in the patient's browser with the patient's
// Tide session, so the server cannot create real ones. The patient logs them in the demo.
import type { Db } from './db.ts';
import { clearDb, transaction } from './db.ts';
import { insertUser, type StoredUser } from './store.ts';

export const DEMO_USERS: StoredUser[] = [
  { id: 'patient-1', username: 'demo.patient', name: 'Alex Demo', role: 'patient' },
  { id: 'physio-1', username: 'demo.physio', name: 'Sam Demo', role: 'professional', profession: 'Physio' },
  { id: 'gp-1', username: 'demo.gp', name: 'Dr Jordan Demo', role: 'professional', profession: 'GP' },
];

/**
 * Deletes all entries, shares and audit events and re-creates the demo users. Tide keys learned
 * from earlier sign-ins are kept unless `keepTideKeys` is false, so professionals stay shareable.
 */
export function resetAndSeed(db: Db, { keepTideKeys = true } = {}): void {
  transaction(db, () => {
    const keys = clearDb(db, { keepTideKeys });
    for (const user of DEMO_USERS) insertUser(db, { ...user, tideUserKey: keys.get(user.username) });
  });
}

export function seedIfEmpty(db: Db): boolean {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  if (n > 0) return false;
  resetAndSeed(db);
  return true;
}

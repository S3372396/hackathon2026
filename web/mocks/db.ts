import type { AuditEvent, Entry, Share, User } from '@contract'
import { SEED_USERS, buildSeedEntries } from './seed.ts'

// MOCK DATABASE: lives in memory and is mirrored to localStorage so a page reload keeps
// the demo state. Not a real store and not secure. Use resetDb() to restore the seed.
export interface Db {
  users: User[]
  entries: Entry[]
  shares: Share[]
  audit: AuditEvent[]
}

// Bump when the seed shape changes so stale saved state is ignored.
const STORAGE_KEY = 'mockDb:v1'

function seedDb(now: Date = new Date()): Db {
  return { users: structuredClone(SEED_USERS), entries: buildSeedEntries(now), shares: [], audit: [] }
}

function loadSaved(): Db | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw) as Db
    const valid = [saved.users, saved.entries, saved.shares, saved.audit].every(Array.isArray)
    return valid ? saved : null
  } catch {
    return null
  }
}

let db: Db = loadSaved() ?? seedDb()

export function getDb(): Db {
  return db
}

export function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  } catch {
    // No storage (private mode, tests): state just lives in memory.
  }
}

// Restores the seed data: 14 days of entries, a physio and a GP, no shares, empty audit log.
export function resetDb(now: Date = new Date()) {
  db = seedDb(now)
  persist()
}

// The mock has no real ids; this is enough to keep them unique within one demo.
export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

// Marks active shares whose expiry has passed. Called before any read of share state,
// so expiry takes effect even though nothing runs on a timer.
export function expireDueShares(now: Date = new Date()) {
  let changed = false
  for (const share of db.shares) {
    if (share.status === 'active' && new Date(share.expiresAt) <= now) {
      share.status = 'expired'
      db.audit.push({
        id: newId('a'),
        patientId: share.patientId,
        shareId: share.id,
        action: 'expired',
        actorId: 'system',
        at: share.expiresAt,
      })
      changed = true
    }
  }
  if (changed) persist()
}

export function recordAudit(event: Omit<AuditEvent, 'id' | 'at'>) {
  db.audit.push({ id: newId('a'), at: new Date().toISOString(), ...event })
}

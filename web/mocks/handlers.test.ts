import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupServer } from 'msw/node'
import type { AuditEvent, Entry, Share, User } from '@contract'
import { GP_ID, PATIENT_ID, PHYSIO_ID } from '../src/demo/demoUsers.ts'
import { getDb, resetDb } from './db.ts'
import { handlers } from './handlers.ts'

// The handlers use relative paths ('/api/me'). MSW resolves those against
// location.href, which Node doesn't have, so give it one before the handlers load.
vi.hoisted(() => {
  Object.defineProperty(globalThis, 'location', {
    value: { href: 'http://localhost/' },
    configurable: true,
  })
})

const server = setupServer(...handlers)

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterAll(() => server.close())
beforeEach(() => resetDb())

async function call<T = unknown>(method: string, path: string, as?: string, body?: unknown) {
  const headers: Record<string, string> = {}
  if (as) headers['X-Demo-User'] = as
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T }
}

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()

async function shareSymptoms(recipientId = PHYSIO_ID, expiresAt = inDays(7)) {
  const entries = await call<Entry[]>('GET', '/api/entries', PATIENT_ID)
  const entryIds = entries.body.filter((e) => e.type === 'symptom').map((e) => e.id)
  const created = await call<Share>('POST', '/api/shares', PATIENT_ID, { recipientId, entryIds, expiresAt })
  return { entryIds, share: created.body, status: created.status }
}

describe('seed data', () => {
  it('has a patient, a physio and a GP', async () => {
    const me = await Promise.all([PATIENT_ID, PHYSIO_ID, GP_ID].map((id) => call<User>('GET', '/api/me', id)))
    expect(me.map((r) => r.body.role)).toEqual(['patient', 'professional', 'professional'])
    expect(me.map((r) => r.body.profession)).toEqual([undefined, 'Physio', 'GP'])
  })

  it('has about 14 days of habit, mood and symptom entries for the patient', async () => {
    const { body } = await call<Entry[]>('GET', '/api/entries', PATIENT_ID)
    expect(new Set(body.map((e) => e.type))).toEqual(new Set(['habit', 'mood', 'symptom']))
    const days = new Set(body.map((e) => new Date(e.loggedAt).toDateString()))
    expect(days.size).toBe(14)
    expect(body.every((e) => e.patientId === PATIENT_ID)).toBe(true)
  })

  it('is restored by resetDb', async () => {
    await shareSymptoms()
    await call('POST', '/api/entries', PATIENT_ID, { type: 'mood', title: 'Extra', value: 3, loggedAt: inDays(0) })
    const before = getDb().entries.length
    resetDb()
    expect(getDb().entries.length).toBeLessThan(before)
    expect(getDb().shares).toEqual([])
    expect(getDb().audit).toEqual([])
  })
})

describe('every endpoint in the contract responds', () => {
  it('answers each one for the right user', async () => {
    const { share } = await shareSymptoms()
    const checks: [string, string, string, number, unknown?][] = [
      ['GET', '/api/me', PATIENT_ID, 200],
      ['GET', '/api/professionals', PATIENT_ID, 200],
      ['GET', '/api/entries', PATIENT_ID, 200],
      ['POST', '/api/entries', PATIENT_ID, 201, { type: 'habit', title: 'Walk', value: 20, loggedAt: inDays(0) }],
      ['GET', '/api/shares', PATIENT_ID, 200],
      ['GET', '/api/shares', PHYSIO_ID, 200],
      ['GET', `/api/shares/${share.id}/package`, PHYSIO_ID, 200],
      ['GET', '/api/audit', PATIENT_ID, 200],
      ['POST', `/api/shares/${share.id}/withdraw`, PATIENT_ID, 200],
    ]
    for (const [method, path, as, status, body] of checks) {
      expect((await call(method, path, as, body)).status, `${method} ${path}`).toBe(status)
    }
    // PUT needs an existing entry id.
    const [first] = (await call<Entry[]>('GET', '/api/entries', PATIENT_ID)).body
    const put = await call<Entry>('PUT', '/api/entries', PATIENT_ID, { ...first, title: 'Renamed' })
    expect(put.status).toBe(200)
    expect(put.body.title).toBe('Renamed')
  })

  it('returns 401 with no user and 403 for the wrong role', async () => {
    expect((await call('GET', '/api/me')).status).toBe(401)
    expect((await call('GET', '/api/entries', PHYSIO_ID)).status).toBe(403)
    expect((await call('GET', '/api/professionals', PHYSIO_ID)).status).toBe(403)
    expect((await call('GET', '/api/audit', GP_ID)).status).toBe(403)
    expect((await call('POST', '/api/shares', GP_ID, {})).status).toBe(403)
  })

  it('returns 404 JSON for unknown api paths', async () => {
    expect((await call('GET', '/api/nope', PATIENT_ID)).status).toBe(404)
  })
})

describe('entries', () => {
  it('creates and edits only the patient\'s own entries, and validates input', async () => {
    const created = await call<Entry>('POST', '/api/entries', PATIENT_ID, {
      type: 'symptom',
      title: '  Knee ache ',
      value: 4,
      notes: ' after run ',
      loggedAt: inDays(0),
    })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ patientId: PATIENT_ID, title: 'Knee ache', notes: 'after run' })

    expect((await call('POST', '/api/entries', PATIENT_ID, { type: 'nope', title: 'x', loggedAt: inDays(0) })).status).toBe(400)
    expect((await call('POST', '/api/entries', PATIENT_ID, { type: 'mood', title: ' ', loggedAt: inDays(0) })).status).toBe(400)
    expect((await call('POST', '/api/entries', PATIENT_ID, { type: 'mood', title: 'x', loggedAt: 'not a date' })).status).toBe(400)
    expect((await call('PUT', '/api/entries', PATIENT_ID, { ...created.body, id: 'e-missing' })).status).toBe(404)
  })
})

describe('sharing', () => {
  it('creates an active share, logs it, and lets only the recipient see it listed', async () => {
    const { share, status, entryIds } = await shareSymptoms()
    expect(status).toBe(201)
    expect(share).toMatchObject({ patientId: PATIENT_ID, recipientId: PHYSIO_ID, status: 'active' })
    expect(share.entryIds).toEqual(entryIds)

    expect((await call<Share[]>('GET', '/api/shares', PATIENT_ID)).body.map((s) => s.id)).toEqual([share.id])
    expect((await call<Share[]>('GET', '/api/shares', PHYSIO_ID)).body.map((s) => s.id)).toEqual([share.id])
    expect((await call<Share[]>('GET', '/api/shares', GP_ID)).body).toEqual([])

    const audit = (await call<AuditEvent[]>('GET', '/api/audit', PATIENT_ID)).body
    expect(audit.map((a) => [a.action, a.shareId, a.actorId])).toEqual([['created', share.id, PATIENT_ID]])
  })

  it('rejects bad share requests', async () => {
    const entries = (await call<Entry[]>('GET', '/api/entries', PATIENT_ID)).body
    const good = { recipientId: PHYSIO_ID, entryIds: [entries[0].id], expiresAt: inDays(1) }
    expect((await call('POST', '/api/shares', PATIENT_ID, { ...good, recipientId: PATIENT_ID })).status).toBe(400)
    expect((await call('POST', '/api/shares', PATIENT_ID, { ...good, entryIds: [] })).status).toBe(400)
    expect((await call('POST', '/api/shares', PATIENT_ID, { ...good, entryIds: ['e-nope'] })).status).toBe(400)
    expect((await call('POST', '/api/shares', PATIENT_ID, { ...good, expiresAt: inDays(-1) })).status).toBe(400)
    expect(getDb().shares).toEqual([])
  })
})

describe('GET /api/shares/:id/package', () => {
  it('gives the recipient exactly the shared entries', async () => {
    const { share, entryIds } = await shareSymptoms()
    const res = await call<Entry[]>('GET', `/api/shares/${share.id}/package`, PHYSIO_ID)
    expect(res.status).toBe(200)
    expect(res.body.map((e) => e.id).sort()).toEqual([...entryIds].sort())
    expect(res.body.every((e) => e.type === 'symptom')).toBe(true)
  })

  it('returns 403 and no data to a professional who was not given access', async () => {
    const { share } = await shareSymptoms()
    const res = await call('GET', `/api/shares/${share.id}/package`, GP_ID)
    expect(res.status).toBe(403)
    expect(JSON.stringify(res.body)).not.toContain('Lower back pain')
  })

  it('returns 403 to the patient too, and for ids that do not exist', async () => {
    const { share } = await shareSymptoms()
    expect((await call('GET', `/api/shares/${share.id}/package`, PATIENT_ID)).status).toBe(403)
    expect((await call('GET', '/api/shares/s-nope/package', PHYSIO_ID)).status).toBe(403)
  })

  it('returns 403 after the share is withdrawn', async () => {
    const { share } = await shareSymptoms()
    const withdrawn = await call<Share>('POST', `/api/shares/${share.id}/withdraw`, PATIENT_ID)
    expect(withdrawn.body.status).toBe('withdrawn')
    const res = await call('GET', `/api/shares/${share.id}/package`, PHYSIO_ID)
    expect(res.status).toBe(403)
    expect(JSON.stringify(res.body)).not.toContain('Lower back pain')
  })

  it('returns 403 once the share has expired, and marks it expired', async () => {
    const { share } = await shareSymptoms()
    getDb().shares[0].expiresAt = inDays(-1)
    const res = await call('GET', `/api/shares/${share.id}/package`, PHYSIO_ID)
    expect(res.status).toBe(403)
    const listed = (await call<Share[]>('GET', '/api/shares', PATIENT_ID)).body
    expect(listed[0].status).toBe('expired')
    const actions = (await call<AuditEvent[]>('GET', '/api/audit', PATIENT_ID)).body.map((a) => a.action)
    expect(actions.filter((a) => a === 'expired')).toHaveLength(1)
  })
})

describe('withdraw and audit trail', () => {
  it('records each step of the demo path', async () => {
    const { share } = await shareSymptoms()
    await call('GET', `/api/shares/${share.id}/package`, PHYSIO_ID)
    await call('GET', `/api/shares/${share.id}/package`, GP_ID)
    await call('POST', `/api/shares/${share.id}/withdraw`, PATIENT_ID)
    await call('GET', `/api/shares/${share.id}/package`, PHYSIO_ID)

    const audit = (await call<AuditEvent[]>('GET', '/api/audit', PATIENT_ID)).body
    expect(audit.map((a) => [a.action, a.actorId])).toEqual([
      ['created', PATIENT_ID],
      ['viewed', PHYSIO_ID],
      ['denied', GP_ID],
      ['withdrawn', PATIENT_ID],
      ['denied', PHYSIO_ID],
    ])
  })

  it('withdrawing twice does not add a second event', async () => {
    const { share } = await shareSymptoms()
    await call('POST', `/api/shares/${share.id}/withdraw`, PATIENT_ID)
    const again = await call<Share>('POST', `/api/shares/${share.id}/withdraw`, PATIENT_ID)
    expect(again.body.status).toBe('withdrawn')
    expect(getDb().audit.filter((a) => a.action === 'withdrawn')).toHaveLength(1)
  })

  it('only the owning patient can withdraw', async () => {
    const { share } = await shareSymptoms()
    expect((await call('POST', `/api/shares/${share.id}/withdraw`, PHYSIO_ID)).status).toBe(403)
    expect((await call('POST', '/api/shares/s-nope/withdraw', PATIENT_ID)).status).toBe(404)
    expect(getDb().shares[0].status).toBe('active')
  })
})

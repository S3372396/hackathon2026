import { http, HttpResponse } from 'msw/http'
import type { Entry, Role, Share, User } from '@contract'
import { expireDueShares, getDb, newId, persist, recordAudit } from './db.ts'

// MOCK API: follows the contract in /contract and the table in PLAN_MEMBER_1.md. It
// stands in for Member 2's server until the midpoint swap. Nothing here is secure: the
// caller is trusted from an X-Demo-User header and entries are returned as plaintext.

type Params = Record<string, string | readonly string[] | undefined>

const fail = (status: number, error: string) => HttpResponse.json({ error }, { status })

function currentUser(request: Request): User | undefined {
  const id = request.headers.get('X-Demo-User')
  return getDb().users.find((u) => u.id === id)
}

// Wraps a resolver: 401 without a user, 403 when `role` is given and doesn't match.
function guard(
  role: Role | null,
  handler: (user: User, request: Request, params: Params) => Response | Promise<Response>,
) {
  return ({ request, params }: { request: Request; params: Params }) => {
    const user = currentUser(request)
    if (!user) return fail(401, 'Not signed in')
    if (role && user.role !== role) return fail(403, `Only a ${role} can do this`)
    return handler(user, request, params)
  }
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json()
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const ENTRY_TYPES: Entry['type'][] = ['habit', 'mood', 'symptom']

function parseEntryInput(
  body: Record<string, unknown>,
): { entry: Omit<Entry, 'id' | 'patientId'> } | { error: string } {
  const { type, title, value, notes, loggedAt } = body
  if (typeof type !== 'string' || !ENTRY_TYPES.includes(type as Entry['type'])) {
    return { error: 'type must be habit, mood or symptom' }
  }
  if (typeof title !== 'string' || !title.trim()) return { error: 'title is required' }
  const validValue =
    value === undefined || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
  if (!validValue) return { error: 'value must be a number or a string' }
  if (notes !== undefined && typeof notes !== 'string') return { error: 'notes must be a string' }
  if (typeof loggedAt !== 'string' || Number.isNaN(Date.parse(loggedAt))) {
    return { error: 'loggedAt must be an ISO date' }
  }
  return {
    entry: {
      type: type as Entry['type'],
      title: title.trim(),
      value: value as number | string | undefined,
      notes: notes?.trim() || undefined,
      loggedAt,
    },
  }
}

export const handlers = [
  http.get('/api/me', guard(null, (user) => HttpResponse.json(user))),

  http.get(
    '/api/professionals',
    guard('patient', () => HttpResponse.json(getDb().users.filter((u) => u.role === 'professional'))),
  ),

  http.get(
    '/api/entries',
    guard('patient', (user) => HttpResponse.json(getDb().entries.filter((e) => e.patientId === user.id))),
  ),

  http.post(
    '/api/entries',
    guard('patient', async (user, request) => {
      const body = await readJson(request)
      if (!body) return fail(400, 'Invalid JSON body')
      const parsed = parseEntryInput(body)
      if ('error' in parsed) return fail(400, parsed.error)
      const entry: Entry = { id: newId('e'), patientId: user.id, ...parsed.entry }
      getDb().entries.push(entry)
      persist()
      return HttpResponse.json(entry, { status: 201 })
    }),
  ),

  // The contract lists PUT /api/entries with no id in the path, so the id travels in the body.
  http.put(
    '/api/entries',
    guard('patient', async (user, request) => {
      const body = await readJson(request)
      if (!body) return fail(400, 'Invalid JSON body')
      const existing = getDb().entries.find((e) => e.id === body.id && e.patientId === user.id)
      if (!existing) return fail(404, 'Entry not found')
      const parsed = parseEntryInput(body)
      if ('error' in parsed) return fail(400, parsed.error)
      Object.assign(existing, parsed.entry)
      persist()
      return HttpResponse.json(existing)
    }),
  ),

  http.post(
    '/api/shares',
    guard('patient', async (user, request) => {
      const body = await readJson(request)
      if (!body) return fail(400, 'Invalid JSON body')
      const { recipientId, entryIds, expiresAt } = body
      const db = getDb()

      const recipient = db.users.find((u) => u.id === recipientId && u.role === 'professional')
      if (!recipient) return fail(400, 'recipientId must be a professional')

      const validIds =
        Array.isArray(entryIds) && entryIds.length > 0 && entryIds.every((id) => typeof id === 'string')
      if (!validIds) return fail(400, 'entryIds must be a non-empty list')
      const owned = new Set(db.entries.filter((e) => e.patientId === user.id).map((e) => e.id))
      if (!(entryIds as string[]).every((id) => owned.has(id))) {
        return fail(400, 'entryIds must all be your own entries')
      }

      if (typeof expiresAt !== 'string' || !(Date.parse(expiresAt) > Date.now())) {
        return fail(400, 'expiresAt must be a date in the future')
      }

      const share: Share = {
        id: newId('s'),
        patientId: user.id,
        recipientId: recipient.id,
        entryIds: [...new Set(entryIds as string[])],
        expiresAt: new Date(expiresAt).toISOString(),
        status: 'active',
        createdAt: new Date().toISOString(),
      }
      db.shares.push(share)
      recordAudit({ patientId: user.id, shareId: share.id, action: 'created', actorId: user.id })
      persist()
      return HttpResponse.json(share, { status: 201 })
    }),
  ),

  http.get(
    '/api/shares',
    guard(null, (user) => {
      expireDueShares()
      const mine = getDb().shares.filter((s) =>
        user.role === 'patient' ? s.patientId === user.id : s.recipientId === user.id,
      )
      return HttpResponse.json(mine)
    }),
  ),

  http.get(
    '/api/shares/:id/package',
    guard(null, (user, _request, params) => {
      expireDueShares()
      const db = getDb()
      const share = db.shares.find((s) => s.id === params.id)
      // Unknown ids get the same 403 as a refused share, so ids can't be probed.
      if (!share) return fail(403, 'Access denied')

      const allowed =
        user.role === 'professional' && share.recipientId === user.id && share.status === 'active'
      if (!allowed) {
        // The owner poking at their own share isn't a denial worth logging.
        if (user.id !== share.patientId) {
          recordAudit({ patientId: share.patientId, shareId: share.id, action: 'denied', actorId: user.id })
          persist()
        }
        return fail(403, 'Access denied')
      }

      recordAudit({ patientId: share.patientId, shareId: share.id, action: 'viewed', actorId: user.id })
      persist()
      const shared = db.entries
        .filter((e) => share.entryIds.includes(e.id))
        .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt))
      return HttpResponse.json(shared)
    }),
  ),

  http.post(
    '/api/shares/:id/withdraw',
    guard('patient', (user, _request, params) => {
      expireDueShares()
      const share = getDb().shares.find((s) => s.id === params.id && s.patientId === user.id)
      if (!share) return fail(404, 'Share not found')
      // Idempotent: withdrawing an already withdrawn or expired share changes nothing.
      if (share.status === 'active') {
        share.status = 'withdrawn'
        recordAudit({ patientId: user.id, shareId: share.id, action: 'withdrawn', actorId: user.id })
        persist()
      }
      return HttpResponse.json(share)
    }),
  ),

  http.get(
    '/api/audit',
    guard('patient', (user) => {
      expireDueShares()
      return HttpResponse.json(getDb().audit.filter((a) => a.patientId === user.id))
    }),
  ),

  // Anything else under /api is a mistake in the client, not a page for the SPA to serve.
  http.all('/api/*', () => fail(404, 'Not found')),
]

import type { AuditEvent, Entry, Share, User } from '@contract'
import { USING_MOCK_API } from '../config.ts'
import { getCurrentUserId } from './session.ts'

export class ApiError extends Error {
  status: number

  // status 0 means the request never got a response (network failure).
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function readMessage(res: Response): Promise<string> {
  try {
    const body = await res.json()
    if (body && typeof body.error === 'string') return body.error
  } catch {
    // Not JSON; fall through to the status text.
  }
  return res.statusText || `Request failed (${res.status})`
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  // MOCK ONLY: the mock API has no login, so it trusts this header to know who is asking.
  if (USING_MOCK_API) headers.set('X-Demo-User', getCurrentUserId())

  let res: Response
  try {
    res = await fetch(path, { ...init, headers })
  } catch {
    throw new ApiError(0, 'Could not reach the server.')
  }
  if (!res.ok) throw new ApiError(res.status, await readMessage(res))
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export type EntryInput = Omit<Entry, 'id' | 'patientId'>

export interface ShareInput {
  recipientId: string
  entryIds: string[]
  expiresAt: string
}

const json = (body: unknown) => JSON.stringify(body)

export const api = {
  me: () => apiFetch<User>('/api/me'),
  professionals: () => apiFetch<User[]>('/api/professionals'),
  entries: () => apiFetch<Entry[]>('/api/entries'),
  createEntry: (input: EntryInput) => apiFetch<Entry>('/api/entries', { method: 'POST', body: json(input) }),
  updateEntry: (entry: Entry) => apiFetch<Entry>('/api/entries', { method: 'PUT', body: json(entry) }),
  shares: () => apiFetch<Share[]>('/api/shares'),
  createShare: (input: ShareInput) => apiFetch<Share>('/api/shares', { method: 'POST', body: json(input) }),
  withdrawShare: (id: string) => apiFetch<Share>(`/api/shares/${id}/withdraw`, { method: 'POST' }),
  audit: () => apiFetch<AuditEvent[]>('/api/audit'),
}

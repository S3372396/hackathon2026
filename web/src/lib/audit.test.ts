import { describe, expect, it } from 'vitest'
import type { AuditEvent, Share } from '@contract'
import { actorName, describeAuditEvent, groupAuditByShare } from './audit.ts'

const event = (partial: Partial<AuditEvent>): AuditEvent => ({
  id: 'a',
  patientId: 'p',
  action: 'created',
  actorId: 'p',
  at: '2026-03-01T10:00:00.000Z',
  ...partial,
})

const share = (id: string, createdAt: string): Share => ({
  id,
  patientId: 'p',
  recipientId: 'r',
  entryIds: [],
  expiresAt: '2026-04-01T00:00:00.000Z',
  status: 'active',
  createdAt,
})

describe('actorName', () => {
  const names = new Map([['r', 'Jordan Lee']])
  it('names the patient, the system, known users and strangers', () => {
    expect(actorName('p', 'p', names)).toBe('You')
    expect(actorName('system', 'p', names)).toBe('The system')
    expect(actorName('r', 'p', names)).toBe('Jordan Lee')
    expect(actorName('x', 'p', names)).toBe('Someone else')
  })
})

describe('describeAuditEvent', () => {
  it('covers every action', () => {
    const text = (action: AuditEvent['action']) => describeAuditEvent(event({ action }), 'Jordan Lee', 'Sam')
    expect(text('created')).toBe('Jordan Lee shared entries with Sam')
    expect(text('viewed')).toBe('Jordan Lee opened the shared entries')
    expect(text('denied')).toBe('Jordan Lee tried to open the shared entries and was refused')
    expect(text('withdrawn')).toBe('Jordan Lee withdrew access for Sam')
    expect(text('expired')).toBe('Access for Sam expired')
  })
})

describe('groupAuditByShare', () => {
  it('groups by share, newest share first, events oldest first', () => {
    const shares = [share('s1', '2026-03-01T00:00:00.000Z'), share('s2', '2026-03-02T00:00:00.000Z')]
    const groups = groupAuditByShare(
      [
        event({ id: '3', shareId: 's1', at: '2026-03-01T12:00:00.000Z', action: 'viewed' }),
        event({ id: '1', shareId: 's1', at: '2026-03-01T10:00:00.000Z' }),
        event({ id: '2', shareId: 's2', at: '2026-03-02T10:00:00.000Z' }),
      ],
      shares,
    )
    expect(groups.map((g) => g.share?.id)).toEqual(['s2', 's1'])
    expect(groups[1].events.map((e) => e.id)).toEqual(['1', '3'])
  })

  it('puts events for unknown shares in a final group with no share', () => {
    const groups = groupAuditByShare([event({ shareId: 'gone' }), event({ id: 'b' })], [])
    expect(groups).toHaveLength(1)
    expect(groups[0].share).toBeNull()
    expect(groups[0].events).toHaveLength(2)
  })
})

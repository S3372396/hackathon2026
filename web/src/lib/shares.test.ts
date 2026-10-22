import { describe, expect, it } from 'vitest'
import type { Share } from '@contract'
import { accessFailureKind, effectiveStatus, newestFirst } from './shares.ts'

const share = (partial: Partial<Share>): Share => ({
  id: 's',
  patientId: 'p',
  recipientId: 'r',
  entryIds: [],
  expiresAt: '2026-03-10T12:00:00.000Z',
  status: 'active',
  createdAt: '2026-03-01T12:00:00.000Z',
  ...partial,
})

describe('effectiveStatus', () => {
  const at = (iso: string) => new Date(iso).getTime()

  it('treats an active share past its expiry as expired', () => {
    expect(effectiveStatus(share({}), at('2026-03-09T12:00:00.000Z'))).toBe('active')
    expect(effectiveStatus(share({}), at('2026-03-10T12:00:00.000Z'))).toBe('expired')
    expect(effectiveStatus(share({}), at('2026-04-01T00:00:00.000Z'))).toBe('expired')
  })

  it('never turns a withdrawn share back into anything else', () => {
    expect(effectiveStatus(share({ status: 'withdrawn' }), at('2026-04-01T00:00:00.000Z'))).toBe('withdrawn')
    expect(effectiveStatus(share({ status: 'withdrawn' }), at('2026-03-02T00:00:00.000Z'))).toBe('withdrawn')
  })
})

describe('newestFirst', () => {
  it('sorts by creation time without changing the input', () => {
    const older = share({ id: 'old', createdAt: '2026-03-01T00:00:00.000Z' })
    const newer = share({ id: 'new', createdAt: '2026-03-02T00:00:00.000Z' })
    const input = [older, newer]
    expect(newestFirst(input).map((s) => s.id)).toEqual(['new', 'old'])
    expect(input.map((s) => s.id)).toEqual(['old', 'new'])
  })
})

describe('accessFailureKind', () => {
  const now = new Date('2026-03-05T00:00:00.000Z').getTime()

  it('explains withdrawn and expired shares', () => {
    const shares = [
      share({ id: 'w', status: 'withdrawn' }),
      share({ id: 'e', expiresAt: '2026-03-02T00:00:00.000Z' }),
    ]
    expect(accessFailureKind(shares, 'w', now)).toBe('withdrawn')
    expect(accessFailureKind(shares, 'e', now)).toBe('expired')
  })

  it('says only "denied" for unknown shares and for shares that look active', () => {
    const shares = [share({ id: 'a', expiresAt: '2026-04-01T00:00:00.000Z' })]
    expect(accessFailureKind(shares, 'nope', now)).toBe('denied')
    expect(accessFailureKind(shares, 'a', now)).toBe('denied')
  })
})

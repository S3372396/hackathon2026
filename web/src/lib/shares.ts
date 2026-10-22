import type { Entry, Share } from '@contract'
import { nowMs } from './dates.ts'

export type ShareStatus = Share['status']

export const STATUS_LABEL: Record<ShareStatus, string> = {
  active: 'Active',
  withdrawn: 'Withdrawn',
  expired: 'Expired',
}

// The server is the source of truth, but it only notices an expiry when something asks.
// An "active" share whose time has passed is shown as expired rather than as live access.
export function effectiveStatus(share: Share, now: number = nowMs()): ShareStatus {
  if (share.status === 'active' && new Date(share.expiresAt).getTime() <= now) return 'expired'
  return share.status
}

export function entriesOfShare(share: Share, entries: Entry[]): Entry[] {
  const ids = new Set(share.entryIds)
  return entries.filter((e) => ids.has(e.id))
}

export function newestFirst(shares: Share[]): Share[] {
  return [...shares].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export type AccessFailure = 'denied' | 'withdrawn' | 'expired'

// Why opening a share failed, from the professional's own list of shares. A share that
// isn't in their list, or is still active, is plain "denied": we never say more than that.
export function accessFailureKind(shares: Share[], shareId: string, now: number = nowMs()): AccessFailure {
  const share = shares.find((s) => s.id === shareId)
  if (!share) return 'denied'
  const status = effectiveStatus(share, now)
  return status === 'withdrawn' || status === 'expired' ? status : 'denied'
}

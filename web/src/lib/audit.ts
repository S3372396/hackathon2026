import type { AuditEvent, Share } from '@contract'

// Who an event is attributed to, in words the patient reads. `names` maps user ids to names.
export function actorName(actorId: string, selfId: string, names: Map<string, string>): string {
  if (actorId === selfId) return 'You'
  if (actorId === 'system') return 'The system'
  return names.get(actorId) ?? 'Someone else'
}

export function describeAuditEvent(event: AuditEvent, actor: string, recipient: string): string {
  switch (event.action) {
    case 'created':
      return `${actor} shared entries with ${recipient}`
    case 'viewed':
      return `${actor} opened the shared entries`
    case 'denied':
      return `${actor} tried to open the shared entries and was refused`
    case 'withdrawn':
      return `${actor} withdrew access for ${recipient}`
    case 'expired':
      return `Access for ${recipient} expired`
  }
}

export interface AuditGroup {
  share: Share | null // null for events that don't belong to a known share
  events: AuditEvent[] // oldest first, so a share reads as a story
}

// One group per share, newest share first; events with no known share go last.
export function groupAuditByShare(events: AuditEvent[], shares: Share[]): AuditGroup[] {
  const known = new Map(shares.map((s) => [s.id, s]))
  const byShare = new Map<string, AuditEvent[]>()
  const loose: AuditEvent[] = []

  for (const event of [...events].sort((a, b) => a.at.localeCompare(b.at))) {
    if (event.shareId && known.has(event.shareId)) {
      byShare.set(event.shareId, [...(byShare.get(event.shareId) ?? []), event])
    } else {
      loose.push(event)
    }
  }

  const groups: AuditGroup[] = [...byShare.entries()]
    .map(([id, shareEvents]) => ({ share: known.get(id) as Share, events: shareEvents }))
    .sort((a, b) => b.share.createdAt.localeCompare(a.share.createdAt))
  if (loose.length > 0) groups.push({ share: null, events: loose })
  return groups
}

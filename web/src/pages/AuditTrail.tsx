import { Link } from 'react-router-dom'
import { api } from '../api/client.ts'
import { EmptyState, ErrorState, Loading } from '../components/States.tsx'
import StatusBadge from '../components/StatusBadge.tsx'
import { actorName, describeAuditEvent, groupAuditByShare } from '../lib/audit.ts'
import { formatDateTime } from '../lib/dates.ts'
import { describeEntries, summarizeEntries } from '../lib/entries.ts'
import { effectiveStatus, entriesOfShare } from '../lib/shares.ts'
import { useResource } from '../lib/useResource.ts'
import { useUser } from '../state/sessionContext.ts'

export default function AuditTrail() {
  const me = useUser()
  const { state, reload } = useResource(async () => {
    const [events, shares, entries, professionals] = await Promise.all([
      api.audit(),
      api.shares(),
      api.entries(),
      api.professionals(),
    ])
    return { events, shares, entries, professionals }
  })

  if (state.status === 'loading') return <Loading label="Loading the audit trail…" />
  if (state.status === 'error') {
    return <ErrorState title="Couldn't load the audit trail" message={state.error.message} onRetry={reload} />
  }

  const { events, shares, entries, professionals } = state.data
  const names = new Map(professionals.map((p) => [p.id, p.name]))
  const groups = groupAuditByShare(events, shares)

  return (
    <section>
      <div className="page-head">
        <h1>Audit trail</h1>
      </div>
      <p className="muted">A record of what happened to each share, oldest first within a share.</p>

      {groups.length === 0 ? (
        <EmptyState title="Nothing in the audit trail yet">
          <p>Events appear here when you share entries, and when anyone opens, is refused, or loses access.</p>
          <Link className="btn btn-primary" to="/share">
            Share entries
          </Link>
        </EmptyState>
      ) : (
        <div className="audit-groups">
          {groups.map(({ share, events: groupEvents }) => {
            const recipient = share ? professionals.find((p) => p.id === share.recipientId) : undefined
            const recipientName = recipient?.name ?? 'Unknown professional'
            return (
              <section key={share?.id ?? 'other'} className="card">
                <header className="share-head">
                  <h2>
                    {share ? recipientName : 'Other events'}
                    {recipient?.profession && <span className="muted"> · {recipient.profession}</span>}
                  </h2>
                  {share && <StatusBadge status={effectiveStatus(share)} />}
                </header>
                {share && (
                  <p className="muted small">
                    {describeEntries(summarizeEntries(entriesOfShare(share, entries)))} · access{' '}
                    {effectiveStatus(share) === 'active' ? 'ends' : 'ended'} {formatDateTime(share.expiresAt)}
                  </p>
                )}
                <ol className="audit-events">
                  {groupEvents.map((event) => (
                    <li key={event.id} className={`audit-event audit-${event.action}`}>
                      <time dateTime={event.at}>{formatDateTime(event.at)}</time>
                      <span>
                        {describeAuditEvent(event, actorName(event.actorId, me.id, names), recipientName)}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            )
          })}
        </div>
      )}
    </section>
  )
}

import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client.ts'
import { EmptyState, ErrorState, Loading } from '../components/States.tsx'
import StatusBadge from '../components/StatusBadge.tsx'
import { formatDateTime } from '../lib/dates.ts'
import { effectiveStatus, newestFirst } from '../lib/shares.ts'
import { useResource } from '../lib/useResource.ts'

export default function SharedWithMe() {
  const navigate = useNavigate()
  const [shareId, setShareId] = useState('')
  const { state, reload } = useResource(() => api.shares())

  function openById(event: FormEvent) {
    event.preventDefault()
    const id = shareId.trim()
    if (id) navigate(`/shared/${encodeURIComponent(id)}`)
  }

  if (state.status === 'loading') return <Loading label="Loading shares…" />
  if (state.status === 'error') {
    return <ErrorState title="Couldn't load your shares" message={state.error.message} onRetry={reload} />
  }

  const shares = newestFirst(state.data)

  return (
    <section>
      <div className="page-head">
        <h1>Shared with me</h1>
      </div>

      {shares.length === 0 ? (
        <EmptyState title="Nothing has been shared with you">
          <p>When a patient shares entries with you, they appear here.</p>
        </EmptyState>
      ) : (
        <ul className="share-list">
          {shares.map((share) => {
            const status = effectiveStatus(share)
            return (
              <li key={share.id} className="card share-card">
                <div className="share-head">
                  <h2>
                    {share.entryIds.length} {share.entryIds.length === 1 ? 'entry' : 'entries'} from a patient
                  </h2>
                  <StatusBadge status={status} />
                </div>
                <dl className="summary">
                  <dt>Patient</dt>
                  <dd>
                    <span className="muted">ref</span> {share.patientId}
                  </dd>
                  <dt>Shared</dt>
                  <dd>{formatDateTime(share.createdAt)}</dd>
                  <dt>{status === 'active' ? 'Access ends' : 'Access ended'}</dt>
                  <dd>{formatDateTime(share.expiresAt)}</dd>
                </dl>
                <Link className="btn btn-primary" to={`/shared/${share.id}`}>
                  Open
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      <form className="card form open-by-id" onSubmit={openById}>
        <h2>Open a share by its ID</h2>
        <p className="muted small">
          If someone sent you a share ID, you can try it here. You'll only see it if the patient gave you access.
        </p>
        <div className="inline-form">
          <label htmlFor="share-id" className="sr-only">
            Share ID
          </label>
          <input id="share-id" value={shareId} onChange={(e) => setShareId(e.target.value)} placeholder="Share ID" />
          <button type="submit" className="btn" disabled={!shareId.trim()}>
            Open
          </button>
        </div>
      </form>
    </section>
  )
}

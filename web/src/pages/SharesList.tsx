import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { Entry, Share } from '@contract'
import { api } from '../api/client.ts'
import { EmptyState, ErrorState, Loading } from '../components/States.tsx'
import StatusBadge from '../components/StatusBadge.tsx'
import WithdrawNote from '../components/WithdrawNote.tsx'
import { formatDateTime } from '../lib/dates.ts'
import { describeEntries, summarizeEntries } from '../lib/entries.ts'
import { withdrawAccess } from '../lib/secureShare.ts'
import { effectiveStatus, entriesOfShare, newestFirst } from '../lib/shares.ts'
import { useResource } from '../lib/useResource.ts'

export default function SharesList() {
  const location = useLocation()
  const justShared = (location.state as { justShared?: string } | null)?.justShared
  const [notice, setNotice] = useState<string | null>(justShared ? `Shared with ${justShared}.` : null)

  const { state, reload } = useResource(async () => {
    const [shares, entries, professionals] = await Promise.all([api.shares(), api.entries(), api.professionals()])
    return { shares, entries, professionals }
  })

  if (state.status === 'loading') return <Loading label="Loading your shares…" />
  if (state.status === 'error') {
    return <ErrorState title="Couldn't load your shares" message={state.error.message} onRetry={reload} />
  }

  const { shares, entries, professionals } = state.data

  return (
    <section>
      <div className="page-head">
        <h1>My shares</h1>
        <Link className="btn btn-primary" to="/share">
          New share
        </Link>
      </div>

      {notice && (
        <p className="notice notice-ok" role="status">
          {notice}
        </p>
      )}

      {shares.length === 0 ? (
        <EmptyState title="You haven't shared anything yet">
          <p>Choose a professional and the entries they should see.</p>
          <Link className="btn btn-primary" to="/share">
            Share entries
          </Link>
        </EmptyState>
      ) : (
        <>
          <WithdrawNote />
          <ul className="share-list">
            {newestFirst(shares).map((share) => {
              const recipient = professionals.find((p) => p.id === share.recipientId)
              return (
                <ShareCard
                  key={share.id}
                  share={share}
                  entries={entriesOfShare(share, entries)}
                  recipientName={recipient?.name ?? 'Unknown professional'}
                  profession={recipient?.profession}
                  onWithdrawn={() => {
                    setNotice(`Access withdrawn for ${recipient?.name ?? 'this professional'}.`)
                    reload()
                  }}
                />
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}

function ShareCard({
  share,
  entries,
  recipientName,
  profession,
  onWithdrawn,
}: {
  share: Share
  entries: Entry[]
  recipientName: string
  profession?: string
  onWithdrawn: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const status = effectiveStatus(share)

  async function withdraw() {
    setBusy(true)
    setError(null)
    try {
      await withdrawAccess(share.id)
      await api.withdrawShare(share.id)
      setConfirming(false)
      onWithdrawn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not withdraw access.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="card share-card">
      <div className="share-head">
        <h2>
          {recipientName}
          {profession && <span className="muted"> · {profession}</span>}
        </h2>
        <StatusBadge status={status} />
      </div>
      <dl className="summary">
        <dt>Shared</dt>
        <dd>{describeEntries(summarizeEntries(entries))}</dd>
        <dt>Created</dt>
        <dd>{formatDateTime(share.createdAt)}</dd>
        <dt>{status === 'active' ? 'Access ends' : 'Access ended'}</dt>
        <dd>{formatDateTime(share.expiresAt)}</dd>
      </dl>

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}

      {status === 'active' &&
        (confirming ? (
          <div className="confirm-box" role="group" aria-label={`Withdraw access for ${recipientName}`}>
            <p>
              Withdraw access for {recipientName}? They won't be able to open this share again. This can't be
              undone, but you can always share again.
            </p>
            <div className="form-actions">
              <button type="button" className="btn btn-danger" disabled={busy} onClick={withdraw}>
                {busy ? 'Withdrawing…' : 'Withdraw access'}
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => setConfirming(false)}>
                Keep sharing
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn" onClick={() => setConfirming(true)}>
            Withdraw access
          </button>
        ))}
    </li>
  )
}

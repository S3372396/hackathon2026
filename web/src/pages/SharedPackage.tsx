import { Link, useParams } from 'react-router-dom'
import type { Entry } from '@contract'
import { ApiError, api } from '../api/client.ts'
import { getCurrentUserId } from '../api/session.ts'
import EntryTimeline from '../components/EntryTimeline.tsx'
import { ErrorState, Loading } from '../components/States.tsx'
import { describeEntries, summarizeEntries } from '../lib/entries.ts'
import { openPackage } from '../lib/secureShare.ts'
import { accessFailureKind } from '../lib/shares.ts'
import type { AccessFailure } from '../lib/shares.ts'
import { useResource } from '../lib/useResource.ts'

// Entries only ever exist on the 'open' outcome, so a refused share has nowhere to
// carry partial data into the screen.
type Outcome = { kind: 'open'; entries: Entry[] } | { kind: AccessFailure }

// Opening a share is recorded in the patient's audit trail, so identical requests that
// overlap (React StrictMode runs effects twice in development) share one call.
const inFlight = new Map<string, Promise<Outcome>>()

async function openShare(shareId: string): Promise<Outcome> {
  try {
    return { kind: 'open', entries: await openPackage(shareId) }
  } catch (err) {
    // A network or server problem isn't a refusal; let the page offer a retry.
    if (err instanceof ApiError && (err.status === 0 || err.status >= 500)) throw err
    try {
      return { kind: accessFailureKind(await api.shares(), shareId) }
    } catch {
      return { kind: 'denied' }
    }
  }
}

function openOnce(shareId: string): Promise<Outcome> {
  const key = `${getCurrentUserId()}:${shareId}`
  const pending = inFlight.get(key)
  if (pending) return pending
  const request = openShare(shareId).finally(() => inFlight.delete(key))
  inFlight.set(key, request)
  return request
}

const REFUSED: Record<AccessFailure, { title: string; body: string }> = {
  denied: {
    title: 'Access denied',
    body: "You don't have access to this share.",
  },
  withdrawn: {
    title: 'Access withdrawn',
    body: 'The patient has withdrawn access to this share. Nothing from it can be shown.',
  },
  expired: {
    title: 'Access expired',
    body: 'This share has passed its end date. Nothing from it can be shown.',
  },
}

export default function SharedPackage() {
  const { shareId = '' } = useParams()
  const { state, reload } = useResource(() => openOnce(shareId), shareId)

  if (state.status === 'loading') return <Loading label="Opening shared entries…" />
  if (state.status === 'error') {
    return <ErrorState title="Couldn't open this share" message={state.error.message} onRetry={reload} />
  }

  const outcome = state.data

  if (outcome.kind !== 'open') {
    const refused = REFUSED[outcome.kind]
    return (
      <section>
        <div className="state state-denied" role="alert">
          <h1>{refused.title}</h1>
          <p>{refused.body}</p>
          <Link className="btn" to="/shared">
            Back to shared with me
          </Link>
        </div>
      </section>
    )
  }

  return (
    <section>
      <div className="page-head">
        <h1>Shared entries</h1>
        <Link className="btn" to="/shared">
          Back to shared with me
        </Link>
      </div>
      <p className="muted">
        {describeEntries(summarizeEntries(outcome.entries))}. Showing only the entries the patient shared with you.
      </p>
      {outcome.entries.length === 0 ? (
        <p className="muted">This share has no entries.</p>
      ) : (
        <EntryTimeline entries={outcome.entries} />
      )}
    </section>
  )
}

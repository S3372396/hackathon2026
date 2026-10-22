import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Entry, User } from '@contract'
import { api } from '../api/client.ts'
import EntryTimeline from '../components/EntryTimeline.tsx'
import RangeFilter from '../components/RangeFilter.tsx'
import { EmptyState, ErrorState, Loading } from '../components/States.tsx'
import { SECURE_SHARE_IS_STUB } from '../config.ts'
import { formatDateTime, nowMs, toDateTimeInput } from '../lib/dates.ts'
import {
  ENTRY_TYPES,
  TYPE_PLURAL,
  describeEntries,
  filterEntries,
  summarizeEntries,
} from '../lib/entries.ts'
import type { EntryType } from '../lib/entries.ts'
import { protectEntries } from '../lib/secureShare.ts'
import { useDateRange } from '../lib/useDateRange.ts'
import { useResource } from '../lib/useResource.ts'

const STEPS = ['Who', 'What', 'Preview', 'Expiry and confirm']

const DAY_MS = 86_400_000
const EXPIRY_PRESETS = [
  { id: '1d', label: '24 hours', ms: DAY_MS },
  { id: '7d', label: '7 days', ms: 7 * DAY_MS },
  { id: '30d', label: '30 days', ms: 30 * DAY_MS },
] as const

type ExpiryChoice = (typeof EXPIRY_PRESETS)[number]['id'] | 'custom'

// A custom expiry has to leave the recipient a real window to open it.
const MIN_EXPIRY_MS = 60_000

export default function ShareFlow() {
  const { state, reload } = useResource(async () => {
    const [professionals, entries] = await Promise.all([api.professionals(), api.entries()])
    return { professionals, entries }
  })

  if (state.status === 'loading') return <Loading />
  if (state.status === 'error') {
    return <ErrorState title="Couldn't load the share form" message={state.error.message} onRetry={reload} />
  }

  const { professionals, entries } = state.data
  if (entries.length === 0) {
    return (
      <EmptyState title="Nothing to share yet">
        <p>Log some entries first, then choose which ones to share.</p>
        <Link className="btn btn-primary" to="/log">
          Log an entry
        </Link>
      </EmptyState>
    )
  }
  if (professionals.length === 0) {
    return (
      <EmptyState title="No professionals to share with">
        <p>There is nobody to share with right now.</p>
      </EmptyState>
    )
  }
  return <ShareWizard professionals={professionals} entries={entries} />
}

function expiryFor(choice: ExpiryChoice, custom: string): Date | null {
  if (choice === 'custom') {
    const date = new Date(custom)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const preset = EXPIRY_PRESETS.find((p) => p.id === choice)
  return new Date(nowMs() + (preset?.ms ?? DAY_MS))
}

function ShareWizard({ professionals, entries }: { professionals: User[]; entries: Entry[] }) {
  const navigate = useNavigate()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [step, setStep] = useState(0)
  const [recipientId, setRecipientId] = useState<string | null>(null)
  const { preset, range, valid, choosePreset, setRange } = useDateRange(entries, '7')
  const [types, setTypes] = useState<Set<EntryType>>(() => new Set<EntryType>(['symptom']))
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set())
  const [expiry, setExpiry] = useState<ExpiryChoice>('7d')
  const [customExpiry, setCustomExpiry] = useState(() => toDateTimeInput(new Date(nowMs() + 7 * DAY_MS).toISOString()))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Move focus to the step heading so keyboard and screen reader users land on the new step.
  useEffect(() => {
    headingRef.current?.focus()
  }, [step])

  const recipient = professionals.find((p) => p.id === recipientId)
  const inRange = valid ? filterEntries(entries, { type: 'all', ...range }) : []
  const matching = inRange.filter((e) => types.has(e.type))
  const included = matching.filter((e) => !excluded.has(e.id))

  const expiryDate = expiryFor(expiry, customExpiry)
  const expiryProblem =
    expiryDate && expiryDate.getTime() > nowMs() + MIN_EXPIRY_MS ? null : 'Choose a time at least a minute from now.'

  // Changing what is in scope starts the preview from scratch, so nothing stays
  // unticked from a scope the patient has since left.
  function changeScope(apply: () => void) {
    apply()
    setExcluded(new Set())
  }

  function toggleType(type: EntryType) {
    changeScope(() =>
      setTypes((current) => {
        const next = new Set(current)
        if (next.has(type)) next.delete(type)
        else next.add(type)
        return next
      }),
    )
  }

  function toggleEntry(id: string) {
    setExcluded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const blocker = [
    recipient ? null : 'Choose who to share with.',
    valid && matching.length > 0 ? null : 'No entries match this range and these types.',
    included.length > 0 ? null : 'Tick at least one entry to share.',
    null,
  ][step]

  async function confirm() {
    const expires = expiryFor(expiry, customExpiry)
    if (!recipient || included.length === 0) return
    if (!expires || expires.getTime() <= nowMs() + MIN_EXPIRY_MS) {
      setError('Choose an expiry at least a minute from now.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await protectEntries(included, recipient.id)
      await api.createShare({
        recipientId: recipient.id,
        entryIds: included.map((e) => e.id),
        expiresAt: expires.toISOString(),
      })
      navigate('/shares', { state: { justShared: recipient.name } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the share.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section>
      <div className="page-head">
        <h1>Share with a professional</h1>
      </div>

      <ol className="stepper" aria-label="Steps">
        {STEPS.map((label, i) => (
          <li key={label} aria-current={i === step ? 'step' : undefined} className={i < step ? 'is-done' : undefined}>
            <span className="step-number">{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      <div className="card">
        <h2 ref={headingRef} tabIndex={-1}>
          {step === 0 && 'Who do you want to share with?'}
          {step === 1 && 'What do you want to share?'}
          {step === 2 && 'Check exactly what will be shared'}
          {step === 3 && 'How long should they have access?'}
        </h2>

        {step === 0 && (
          <fieldset className="field">
            <legend className="sr-only">Professional</legend>
            <div className="choice-list">
              {professionals.map((p) => (
                <label key={p.id} className={`choice${recipientId === p.id ? ' is-selected' : ''}`}>
                  <input type="radio" name="recipient" checked={recipientId === p.id} onChange={() => setRecipientId(p.id)} />
                  <span className="choice-title">{p.name}</span>
                  <span className="choice-meta">{p.profession ?? 'Professional'}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {step === 1 && (
          <>
            <div className="filters">
              <RangeFilter
                preset={preset}
                range={range}
                onPreset={(p) => changeScope(() => choosePreset(p))}
                onRange={(r) => changeScope(() => setRange(r))}
              />
            </div>
            <fieldset className="field">
              <legend>Entry types</legend>
              <div className="check-list">
                {ENTRY_TYPES.map((t) => (
                  <label key={t} className="check">
                    <input type="checkbox" checked={types.has(t)} onChange={() => toggleType(t)} />
                    {TYPE_PLURAL[t]}
                    <span className="muted small">({inRange.filter((e) => e.type === t).length} in this range)</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {valid ? (
              <p className={matching.length === 0 ? 'field-error' : 'muted'}>
                {matching.length} {matching.length === 1 ? 'entry matches' : 'entries match'}.
              </p>
            ) : (
              <p className="field-error" role="alert">
                Choose a start date that is on or before the end date.
              </p>
            )}
          </>
        )}

        {step === 2 && recipient && (
          <>
            <p>
              {recipient.name} will see the title, value, notes and date of each entry below. Untick anything you
              want to keep back.
            </p>
            <p className="muted small" aria-live="polite">
              Sharing {included.length} of {matching.length} entries.
            </p>
            <EntryTimeline
              entries={matching}
              renderAction={(entry) => (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={!excluded.has(entry.id)}
                    onChange={() => toggleEntry(entry.id)}
                    aria-label={`Share ${entry.title}`}
                  />
                  Share
                </label>
              )}
            />
          </>
        )}

        {step === 3 && recipient && (
          <>
            <fieldset className="field">
              <legend className="sr-only">Access ends</legend>
              <div className="check-list">
                {EXPIRY_PRESETS.map((p) => (
                  <label key={p.id} className="check">
                    <input type="radio" name="expiry" checked={expiry === p.id} onChange={() => setExpiry(p.id)} />
                    {p.label}
                  </label>
                ))}
                <label className="check">
                  <input type="radio" name="expiry" checked={expiry === 'custom'} onChange={() => setExpiry('custom')} />
                  Choose a date and time
                </label>
              </div>
              {expiry === 'custom' && (
                <div className="field">
                  <label htmlFor="custom-expiry">Access ends</label>
                  <input
                    id="custom-expiry"
                    type="datetime-local"
                    value={customExpiry}
                    min={toDateTimeInput(new Date(nowMs()).toISOString())}
                    aria-invalid={expiryProblem ? true : undefined}
                    onChange={(e) => setCustomExpiry(e.target.value)}
                  />
                  {expiryProblem && <p className="field-error">{expiryProblem}</p>}
                </div>
              )}
            </fieldset>

            <h3>Review</h3>
            <dl className="summary">
              <dt>Sharing with</dt>
              <dd>
                {recipient.name}
                {recipient.profession ? `, ${recipient.profession}` : ''}
              </dd>
              <dt>What</dt>
              <dd>{describeEntries(summarizeEntries(included))}</dd>
              <dt>Access ends</dt>
              <dd>{expiryDate && !expiryProblem ? formatDateTime(expiryDate.toISOString()) : 'Not set'}</dd>
            </dl>

            <p className="notice notice-info">
              You can withdraw access at any time. Withdrawing stops future access. It can't undo data someone
              already viewed or copied.
            </p>
            {SECURE_SHARE_IS_STUB && (
              <p className="notice notice-warn">
                Demo only: sharing protection is a placeholder right now, so these entries are not encrypted.
              </p>
            )}
            {error && (
              <p className="notice notice-error" role="alert">
                {error}
              </p>
            )}
          </>
        )}

        <div className="form-actions">
          {step > 0 && (
            <button type="button" className="btn" disabled={submitting} onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn btn-primary" disabled={blocker !== null} onClick={() => setStep(step + 1)}>
              Next
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={submitting || expiryProblem !== null || included.length === 0}
              onClick={confirm}
            >
              {submitting ? 'Sharing…' : `Share ${included.length} ${included.length === 1 ? 'entry' : 'entries'}`}
            </button>
          )}
          <Link className="btn btn-quiet" to="/shares">
            Cancel
          </Link>
          {blocker && (
            <span className="muted small" role="status">
              {blocker}
            </span>
          )}
        </div>
      </div>
    </section>
  )
}

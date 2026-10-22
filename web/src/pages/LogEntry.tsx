import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Entry } from '@contract'
import { api } from '../api/client.ts'
import type { EntryInput } from '../api/client.ts'
import { EmptyState, ErrorState, Loading } from '../components/States.tsx'
import { dateKey, dayKeyToISO, isDayKey, todayKey } from '../lib/dates.ts'
import { ENTRY_TYPES, TYPE_LABEL, VALUE_RULES } from '../lib/entries.ts'
import type { EntryType } from '../lib/entries.ts'
import { useResource } from '../lib/useResource.ts'

const MAX_TITLE = 80
const MAX_NOTES = 500

// Only suggestions, not health advice. Titles the patient already used come first.
const DEFAULT_TITLES: Record<EntryType, string[]> = {
  mood: ['Daily mood'],
  symptom: ['Headache', 'Fatigue', 'Pain'],
  habit: ['Water (glasses)', 'Walk (minutes)', 'Stretching (minutes)'],
}

const MOOD_WORDS = ['Very low', 'Low', 'Okay', 'Good', 'Very good']

interface FormState {
  type: EntryType
  title: string
  value: string
  notes: string
  date: string
}

type Errors = Partial<Record<keyof FormState, string>>

function validate(form: FormState): Errors {
  const errors: Errors = {}
  const rule = VALUE_RULES[form.type]

  if (!form.title.trim()) errors.title = 'Give this entry a title.'
  else if (form.title.trim().length > MAX_TITLE) errors.title = `Keep the title under ${MAX_TITLE} characters.`

  const raw = form.value.trim()
  if (raw === '') {
    if (rule.required) errors.value = form.type === 'mood' ? 'Choose how you feel, from 1 to 5.' : 'Enter a severity from 0 to 10.'
  } else if (form.type !== 'habit') {
    const n = Number(raw)
    if (!Number.isFinite(n) || n < (rule.min ?? -Infinity) || n > (rule.max ?? Infinity)) {
      errors.value = `Enter a number from ${rule.min} to ${rule.max}.`
    }
  } else if (Number.isFinite(Number(raw)) && Number(raw) < 0) {
    errors.value = 'Enter zero or more.'
  }

  if (form.notes.length > MAX_NOTES) errors.notes = `Keep notes under ${MAX_NOTES} characters.`

  if (!isDayKey(form.date)) errors.date = 'Choose a date.'
  else if (form.date > todayKey()) errors.date = "The date can't be in the future."

  return errors
}

function toInput(form: FormState, previous?: Entry): EntryInput {
  const raw = form.value.trim()
  const asNumber = Number(raw)
  let value: number | string | undefined
  if (raw === '') value = undefined
  else value = Number.isFinite(asNumber) ? asNumber : raw // habits may keep free text

  // Keep the original time of day when the date wasn't changed; entries logged today get
  // the current time, other days sit at noon.
  let loggedAt: string
  if (previous && dateKey(previous.loggedAt) === form.date) loggedAt = previous.loggedAt
  else if (form.date === todayKey()) loggedAt = new Date().toISOString()
  else loggedAt = dayKeyToISO(form.date)

  return {
    type: form.type,
    title: form.title.trim(),
    value,
    notes: form.notes.trim() || undefined,
    loggedAt,
  }
}

function initialForm(entry?: Entry): FormState {
  if (!entry) return { type: 'mood', title: DEFAULT_TITLES.mood[0], value: '', notes: '', date: todayKey() }
  return {
    type: entry.type,
    title: entry.title,
    value: entry.value === undefined ? '' : String(entry.value),
    notes: entry.notes ?? '',
    date: dateKey(entry.loggedAt),
  }
}

function suggestionsFor(type: EntryType, entries: Entry[]): string[] {
  const counts = new Map<string, number>()
  for (const e of entries) if (e.type === type) counts.set(e.title, (counts.get(e.title) ?? 0) + 1)
  const used = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([title]) => title)
  return [...new Set([...used, ...DEFAULT_TITLES[type]])]
}

export default function LogEntry() {
  const { entryId } = useParams()
  const { state, reload } = useResource(() => api.entries())

  if (state.status === 'loading') return <Loading />
  if (state.status === 'error') {
    return <ErrorState title="Couldn't load your entries" message={state.error.message} onRetry={reload} />
  }

  const existing = entryId ? state.data.find((e) => e.id === entryId) : undefined
  if (entryId && !existing) {
    return (
      <EmptyState title="Entry not found">
        <Link className="btn" to="/">
          Back to dashboard
        </Link>
      </EmptyState>
    )
  }

  // Keyed so switching between entries (or to a new one) starts from a clean form.
  return <EntryForm key={existing?.id ?? 'new'} existing={existing} entries={state.data} />
}

function EntryForm({ existing, entries }: { existing?: Entry; entries: Entry[] }) {
  const navigate = useNavigate()
  const titleRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<FormState>(() => initialForm(existing))
  const [errors, setErrors] = useState<Errors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const rule = VALUE_RULES[form.type]
  const suggestions = suggestionsFor(form.type, entries)

  function update(patch: Partial<FormState>) {
    setForm((current) => ({ ...current, ...patch }))
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch) as (keyof FormState)[]) delete next[key]
      return next
    })
    setSaved(null)
  }

  function chooseType(type: EntryType) {
    if (type === form.type) return
    // Scales differ between types, so the old value no longer applies.
    const keepTitle = form.title.trim() !== '' && !DEFAULT_TITLES[form.type].includes(form.title)
    update({ type, value: '', title: keepTitle ? form.title : type === 'mood' ? DEFAULT_TITLES.mood[0] : '' })
  }

  async function save(addAnother: boolean) {
    const found = validate(form)
    setErrors(found)
    setSubmitError(null)
    if (Object.keys(found).length > 0) return

    setSubmitting(true)
    try {
      const input = toInput(form, existing)
      if (existing) await api.updateEntry({ ...existing, ...input })
      else await api.createEntry(input)
      if (addAnother) {
        setSaved(input.title)
        setForm((current) => ({ ...current, title: current.type === 'mood' ? current.title : '', value: '', notes: '' }))
        titleRef.current?.focus()
      } else {
        navigate('/')
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save this entry.')
    } finally {
      setSubmitting(false)
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void save(false)
  }

  return (
    <section>
      <div className="page-head">
        <h1>{existing ? 'Edit entry' : 'Log an entry'}</h1>
      </div>
      <form className="card form" onSubmit={onSubmit} noValidate>
        {saved && (
          <p className="notice notice-ok" role="status">
            Saved “{saved}”. You can log another.
          </p>
        )}
        {submitError && (
          <p className="notice notice-error" role="alert">
            {submitError}
          </p>
        )}

        <fieldset className="field">
          <legend>Type</legend>
          <div className="seg-group">
            {ENTRY_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                className="seg"
                aria-pressed={form.type === t}
                onClick={() => chooseType(t)}
              >
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="field">
          <label htmlFor="title">Title</label>
          <input
            id="title"
            ref={titleRef}
            list="title-suggestions"
            value={form.title}
            aria-invalid={errors.title ? true : undefined}
            aria-describedby={errors.title ? 'title-error' : undefined}
            onChange={(e) => update({ title: e.target.value })}
            placeholder={form.type === 'habit' ? 'e.g. Water (glasses)' : form.type === 'symptom' ? 'e.g. Headache' : ''}
          />
          <datalist id="title-suggestions">
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          {errors.title && (
            <p id="title-error" className="field-error">
              {errors.title}
            </p>
          )}
        </div>

        {form.type === 'mood' ? (
          <fieldset className="field" aria-describedby={errors.value ? 'value-error' : undefined}>
            <legend>{rule.label}</legend>
            <div className="scale" role="radiogroup" aria-label="Mood from 1 to 5">
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className={`scale-option${form.value === String(n) ? ' is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="mood"
                    value={n}
                    checked={form.value === String(n)}
                    onChange={() => update({ value: String(n) })}
                  />
                  <span className="scale-number">{n}</span>
                  <span className="scale-word">{MOOD_WORDS[n - 1]}</span>
                </label>
              ))}
            </div>
            {errors.value && (
              <p id="value-error" className="field-error">
                {errors.value}
              </p>
            )}
          </fieldset>
        ) : (
          <div className="field">
            <label htmlFor="value">{rule.label}</label>
            <input
              id="value"
              inputMode="decimal"
              value={form.value}
              aria-invalid={errors.value ? true : undefined}
              aria-describedby={errors.value ? 'value-error value-hint' : 'value-hint'}
              onChange={(e) => update({ value: e.target.value })}
            />
            <p id="value-hint" className="muted small">
              {rule.hint}
            </p>
            {errors.value && (
              <p id="value-error" className="field-error">
                {errors.value}
              </p>
            )}
          </div>
        )}

        <div className="field">
          <label htmlFor="date">Date</label>
          <input
            id="date"
            type="date"
            value={form.date}
            max={todayKey()}
            aria-invalid={errors.date ? true : undefined}
            aria-describedby={errors.date ? 'date-error' : undefined}
            onChange={(e) => update({ date: e.target.value })}
          />
          {errors.date && (
            <p id="date-error" className="field-error">
              {errors.date}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="notes">Notes (optional)</label>
          <textarea
            id="notes"
            rows={3}
            value={form.notes}
            aria-invalid={errors.notes ? true : undefined}
            aria-describedby={errors.notes ? 'notes-error notes-hint' : 'notes-hint'}
            onChange={(e) => update({ notes: e.target.value })}
          />
          <p id="notes-hint" className="muted small">
            Notes are included if you share this entry.
          </p>
          {errors.notes && (
            <p id="notes-error" className="field-error">
              {errors.notes}
            </p>
          )}
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </button>
          {!existing && (
            <button type="button" className="btn" disabled={submitting} onClick={() => void save(true)}>
              Save and log another
            </button>
          )}
          <Link className="btn btn-quiet" to="/">
            Cancel
          </Link>
        </div>
      </form>
    </section>
  )
}

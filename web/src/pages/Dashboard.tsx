import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client.ts'
import EntryTimeline from '../components/EntryTimeline.tsx'
import RangeFilter from '../components/RangeFilter.tsx'
import { EmptyState, ErrorState, Loading } from '../components/States.tsx'
import { TrendCard } from '../components/TrendChart.tsx'
import { dateKey, daysInRange, formatShortDay } from '../lib/dates.ts'
import { ENTRY_TYPES, TYPE_PLURAL, buildSeries, filterEntries } from '../lib/entries.ts'
import type { EntryType } from '../lib/entries.ts'
import { useDateRange } from '../lib/useDateRange.ts'
import { useResource } from '../lib/useResource.ts'

// More than this and the grid stops being scannable; the timeline still lists everything.
const MAX_CHARTS = 6

// The timeline starts with the most recent days and grows by this many on request.
const TIMELINE_DAYS = 7

export default function Dashboard() {
  const { state, reload } = useResource(() => api.entries())
  const { preset, range, valid, choosePreset, setRange } = useDateRange(state.status === 'ready' ? state.data : [], '14')
  const [type, setType] = useState<EntryType | 'all'>('all')
  const [visibleDays, setVisibleDays] = useState(TIMELINE_DAYS)

  if (state.status === 'loading') return <Loading label="Loading your entries…" />
  if (state.status === 'error') {
    return <ErrorState title="Couldn't load your entries" message={state.error.message} onRetry={reload} />
  }

  const entries = state.data
  const filtered = valid ? filterEntries(entries, { type, ...range }) : []
  const days = valid ? daysInRange(range.from, range.to) : []
  const allSeries = buildSeries(filtered)
  const charts = allSeries.slice(0, MAX_CHARTS)
  const timelineDays = [...new Set(filtered.map((e) => dateKey(e.loggedAt)))].sort().reverse()
  const shownDays = new Set(timelineDays.slice(0, visibleDays))
  const timelineEntries = filtered.filter((e) => shownDays.has(dateKey(e.loggedAt)))
  const hiddenDays = timelineDays.length - shownDays.size

  function clearFilters() {
    choosePreset('14')
    setType('all')
  }

  return (
    <section>
      <div className="page-head">
        <h1>Dashboard</h1>
        <Link className="btn btn-primary" to="/log">
          Log entry
        </Link>
      </div>

      {entries.length === 0 ? (
        <EmptyState title="Nothing logged yet">
          <p>Log a habit, a mood or a symptom to start your journal.</p>
          <Link className="btn btn-primary" to="/log">
            Log your first entry
          </Link>
        </EmptyState>
      ) : (
        <>
          <div className="filters">
            <RangeFilter preset={preset} range={range} onPreset={choosePreset} onRange={setRange} />
            <div className="seg-group" role="group" aria-label="Entry type">
              <button type="button" className="seg" aria-pressed={type === 'all'} onClick={() => setType('all')}>
                All types
              </button>
              {ENTRY_TYPES.map((t) => (
                <button key={t} type="button" className="seg" aria-pressed={type === t} onClick={() => setType(t)}>
                  {TYPE_PLURAL[t]}
                </button>
              ))}
            </div>
          </div>

          {!valid ? (
            <p className="field-error" role="alert">
              Choose a start date that is on or before the end date.
            </p>
          ) : (
            <p className="muted small">
              {formatShortDay(range.from)} to {formatShortDay(range.to)} · {filtered.length}{' '}
              {filtered.length === 1 ? 'entry' : 'entries'}
            </p>
          )}

          {valid && filtered.length === 0 && (
            <EmptyState title="No entries match these filters">
              <button type="button" className="btn" onClick={clearFilters}>
                Show the last 14 days, all types
              </button>
            </EmptyState>
          )}

          {filtered.length > 0 && (
            <>
              <h2 className="section-title">Trends</h2>
              {charts.length === 0 ? (
                <p className="muted">None of these entries have a number to chart. They are listed below.</p>
              ) : (
                <>
                  <div className="chart-grid-layout">
                    {charts.map((series) => (
                      <TrendCard key={series.key} series={series} days={days} />
                    ))}
                  </div>
                  {allSeries.length > charts.length && (
                    <p className="muted small">
                      Showing the {MAX_CHARTS} most-logged of {allSeries.length} series. Everything is in the timeline.
                    </p>
                  )}
                </>
              )}

              <h2 className="section-title">Timeline</h2>
              <EntryTimeline
                entries={timelineEntries}
                renderAction={(entry) => (
                  <Link className="btn btn-quiet" to={`/log/${entry.id}`} aria-label={`Edit ${entry.title}`}>
                    Edit
                  </Link>
                )}
              />
              {hiddenDays > 0 && (
                <button type="button" className="btn" onClick={() => setVisibleDays((n) => n + TIMELINE_DAYS)}>
                  Show older entries ({hiddenDays} more {hiddenDays === 1 ? 'day' : 'days'})
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}

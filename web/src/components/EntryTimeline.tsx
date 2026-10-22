import type { ReactNode } from 'react'
import type { Entry } from '@contract'
import { formatDay } from '../lib/dates.ts'
import { formatValue, groupByDay } from '../lib/entries.ts'
import TypeBadge from './TypeBadge.tsx'

// Every entry, grouped by day. It doubles as the table view of the charts: each value a
// chart shows is listed here without needing a hover.
export default function EntryTimeline({
  entries,
  renderAction,
}: {
  entries: Entry[]
  renderAction?: (entry: Entry) => ReactNode
}) {
  return (
    <div className="timeline">
      {groupByDay(entries).map((group) => (
        <section key={group.day} className="timeline-day">
          <h3>{formatDay(group.day)}</h3>
          <ul className="entry-list">
            {group.entries.map((entry) => (
              <li key={entry.id} className="entry-row">
                <TypeBadge type={entry.type} />
                <div className="entry-main">
                  <span className="entry-title">{entry.title}</span>
                  {entry.notes && <span className="entry-notes">{entry.notes}</span>}
                </div>
                <span className="entry-value">{formatValue(entry)}</span>
                {renderAction && <span className="entry-action">{renderAction(entry)}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

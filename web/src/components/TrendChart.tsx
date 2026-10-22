import { useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { formatDay, formatShortDay } from '../lib/dates.ts'
import { TYPE_LABEL, formatNumber } from '../lib/entries.ts'
import type { Series } from '../lib/entries.ts'
import TypeBadge from './TypeBadge.tsx'

// Geometry is in viewBox units; the SVG scales to its card.
const W = 320
const H = 140
const M = { top: 10, right: 8, bottom: 22, left: 30 }
const PLOT_W = W - M.left - M.right
const PLOT_H = H - M.top - M.bottom
const MAX_BAR = 24
const BAR_RADIUS = 4

// A 0-based axis top that lands on a round number, with an integer midpoint.
function niceMax(max: number): number {
  if (max <= 0) return 4
  const unit = 10 ** Math.floor(Math.log10(max))
  return [2, 4, 6, 8, 10].map((m) => m * unit).find((top) => top >= max) ?? max
}

function yDomain(series: Series): [number, number] {
  const values = series.points.map((p) => p.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (series.type === 'mood') return [Math.min(1, min), Math.max(5, max)]
  if (series.type === 'symptom') return [Math.min(0, min), Math.max(10, max)]
  return [Math.min(0, min), niceMax(max)]
}

// A handful of evenly spaced day indexes to label, always including first and last.
function tickIndexes(count: number, wanted: number): number[] {
  if (count <= wanted) return Array.from({ length: count }, (_, i) => i)
  const picks = Array.from({ length: wanted }, (_, k) => Math.round((k * (count - 1)) / (wanted - 1)))
  return [...new Set(picks)]
}

// A column with a rounded top and a square base, so it grows from the baseline.
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(BAR_RADIUS, w / 2, h)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

// One series over `days`: a line for mood and symptoms, columns for habits. Hover, touch
// and arrow keys all show the same tooltip. Every value is also listed in the timeline.
export default function TrendChart({ series, days }: { series: Series; days: string[] }) {
  const [active, setActive] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const [lo, hi] = yDomain(series)
  const slot = PLOT_W / days.length
  const xAt = (dayIndex: number) => M.left + (dayIndex + 0.5) * slot
  const yAt = (value: number) => M.top + PLOT_H * (1 - (value - lo) / (hi - lo))

  const dayIndex = new Map(days.map((day, i) => [day, i]))
  const points = series.points.flatMap((p) => {
    const i = dayIndex.get(p.day)
    return i === undefined ? [] : [{ ...p, x: xAt(i), y: yAt(p.value) }]
  })
  const isBars = series.type === 'habit'
  const barWidth = Math.min(MAX_BAR, Math.max(2, slot * 0.65))
  const baseline = M.top + PLOT_H
  const yTicks = [lo, (lo + hi) / 2, hi]

  function nearestPoint(clientX: number): number {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    const px = ((clientX - rect.left) / rect.width) * W
    let best = 0
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(points[i].x - px) < Math.abs(points[best].x - px)) best = i
    }
    return best
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    setActive(nearestPoint(event.clientX))
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const step = event.key === 'ArrowRight' ? 1 : -1
    setActive((current) => Math.min(points.length - 1, Math.max(0, (current ?? points.length - 1) + step)))
  }

  const shown = active === null ? null : points[active]
  const summary =
    `${series.title} (${TYPE_LABEL[series.type]}): ${series.entryCount} entries, ` +
    `latest ${formatNumber(series.latest)}, average ${formatNumber(series.average)}. ` +
    'All values are listed in the timeline below.'

  return (
    <div className="chart-wrap">
      <svg
        ref={svgRef}
        className={`chart type-${series.type}`}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={summary}
        tabIndex={0}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive((current) => current ?? points.length - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={onKeyDown}
      >
        {yTicks.map((tick) => (
          <g key={tick}>
            <line className="chart-grid" x1={M.left} x2={W - M.right} y1={yAt(tick)} y2={yAt(tick)} />
            <text className="chart-label" x={M.left - 6} y={yAt(tick)} textAnchor="end" dominantBaseline="middle">
              {formatNumber(tick)}
            </text>
          </g>
        ))}
        <line className="chart-axis" x1={M.left} x2={W - M.right} y1={baseline} y2={baseline} />
        {tickIndexes(days.length, 4).map((i) => (
          <text key={i} className="chart-label" x={xAt(i)} y={H - 6} textAnchor="middle">
            {formatShortDay(days[i])}
          </text>
        ))}

        {isBars ? (
          points.map((p, i) => {
            const height = baseline - p.y
            return height > 0 ? (
              <path
                key={p.day}
                className={`chart-bar${i === active ? ' is-active' : ''}`}
                d={barPath(p.x - barWidth / 2, p.y, barWidth, height)}
              />
            ) : null
          })
        ) : (
          <>
            {shown && <line className="chart-cross" x1={shown.x} x2={shown.x} y1={M.top} y2={baseline} />}
            <polyline className="chart-line" points={points.map((p) => `${p.x},${p.y}`).join(' ')} />
            {points.map((p, i) => (
              <circle key={p.day} className="chart-dot" cx={p.x} cy={p.y} r={i === active ? 6 : 5} />
            ))}
          </>
        )}
      </svg>

      {shown && (
        <div
          className="chart-tip"
          style={{ left: `clamp(20%, ${(shown.x / W) * 100}%, 80%)` }}
          aria-hidden="true"
        >
          <span className="tip-value">
            <span className={`tip-key dot-${series.type}`} />
            {formatNumber(shown.value)}
          </span>
          <span className="tip-label">
            {formatDay(shown.day)}
            {shown.count > 1 && ` · average of ${shown.count}`}
          </span>
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {shown ? `${formatDay(shown.day)}: ${formatNumber(shown.value)}` : ''}
      </span>
    </div>
  )
}

export function TrendCard({ series, days }: { series: Series; days: string[] }) {
  return (
    <article className="chart-card">
      <header className="chart-head">
        <h3>{series.title}</h3>
        <TypeBadge type={series.type} />
      </header>
      <p className="chart-stats">
        Latest <strong>{formatNumber(series.latest)}</strong> · Average{' '}
        <strong>{formatNumber(series.average)}</strong> · {series.entryCount}{' '}
        {series.entryCount === 1 ? 'entry' : 'entries'}
      </p>
      <TrendChart series={series} days={days} />
    </article>
  )
}

'use client'

import { Card } from '@/components/ui/card'

/**
 * Management Dashboard — KPI tile (PROJ-40).
 *
 * Pure presentational component. Renders:
 * - an uppercase label
 * - a large primary number (pre-formatted by caller)
 * - an optional Δ vs. prior period with arrow + color semantics
 * - an optional inline SVG sparkline (60x20), no Recharts
 *
 * Spec: features/PROJ-40-management-dashboard.md (KPI tiles table).
 */

interface KpiTileProps {
  /** Label rendered above the primary number (e.g. "Total savings"). */
  label: string
  /** Pre-formatted primary number (e.g. "€42" or "7.1 ct/kWh"). */
  value: string
  /** Signed percent change vs. prior period. `+18` = up 18%. `null` hides the delta. */
  deltaPct?: number | null
  /** Suffix caption for the delta (e.g. "vs prior period"). */
  deltaLabel?: string
  /** Up to 12 numeric samples used to render the sparkline. */
  sparklineData?: number[]
  /** Stroke color for the sparkline. Defaults to brand red `#EA1C0A`. */
  accentColor?: string
}

/**
 * Build an SVG path `d` attribute for a 60x20 sparkline.
 * - Normalizes y values into the band [2, 18] so the stroke never touches edges.
 * - Single data point → horizontal line at its normalized y.
 * - All-equal values → horizontal line at y=10 (center).
 */
function buildSparkPath(data: number[]): string {
  if (!data || data.length === 0) return ''
  const W = 60
  const Y_MIN = 2
  const Y_MAX = 18
  const span = Y_MAX - Y_MIN

  if (data.length === 1) {
    // Single point → flat line at mid
    return `M 0 ${(Y_MIN + Y_MAX) / 2} L ${W} ${(Y_MIN + Y_MAX) / 2}`
  }

  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const v of data) {
    if (!Number.isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }

  // All equal (or no finite data) → horizontal line at center.
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) {
    return `M 0 10 L ${W} 10`
  }

  const stepX = W / (data.length - 1)
  const parts: string[] = []
  for (let i = 0; i < data.length; i++) {
    const v = Number.isFinite(data[i]) ? data[i] : min
    // Higher value → smaller y (inverted y-axis in SVG).
    const norm = (v - min) / (max - min)
    const y = Y_MAX - norm * span
    const x = i * stepX
    parts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`)
  }
  return parts.join(' ')
}

function formatDeltaPct(deltaPct: number): string {
  const abs = Math.abs(deltaPct)
  return `${abs.toFixed(1)}%`
}

export const KpiTile = ({
  label,
  value,
  deltaPct = null,
  deltaLabel,
  sparklineData,
  accentColor = '#EA1C0A',
}: KpiTileProps) => {
  const hasDelta = deltaPct !== null && deltaPct !== undefined && Number.isFinite(deltaPct)
  const hasSpark = Array.isArray(sparklineData) && sparklineData.length > 0

  let deltaColor = 'text-muted-foreground'
  let deltaArrow = '·'
  if (hasDelta) {
    if ((deltaPct as number) > 0) {
      deltaColor = 'text-emerald-600'
      deltaArrow = '↑'
    } else if ((deltaPct as number) < 0) {
      deltaColor = 'text-red-600'
      deltaArrow = '↓'
    }
  }

  return (
    <Card className="flex flex-col gap-2 p-4 min-h-[120px]">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-4xl font-semibold tabular-nums text-[#313131]">{value}</span>
      <div className="flex justify-between items-end mt-auto">
        {hasDelta ? (
          <span className={`text-xs font-medium tabular-nums ${deltaColor}`}>
            {deltaArrow} {formatDeltaPct(deltaPct as number)}
            {deltaLabel ? <span className="text-muted-foreground font-normal"> {deltaLabel}</span> : null}
          </span>
        ) : (
          <span />
        )}
        {hasSpark ? (
          <svg width={60} height={20} viewBox="0 0 60 20" aria-hidden="true">
            <path
              d={buildSparkPath(sparklineData as number[])}
              fill="none"
              stroke={accentColor}
              strokeWidth={1.25}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </div>
    </Card>
  )
}

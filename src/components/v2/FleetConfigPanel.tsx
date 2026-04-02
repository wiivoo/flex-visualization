'use client'

import { useCallback, useRef } from 'react'
import type { FleetConfig, DistributionEntry } from '@/lib/v2-config'
import type { FleetOptimizationResult } from '@/lib/v2-config'
import { DEFAULT_ARRIVAL_DIST, DEFAULT_DEPARTURE_DIST } from '@/lib/v2-config'

interface Props {
  config: FleetConfig
  onChange: (config: FleetConfig) => void
  optimizationResult?: FleetOptimizationResult | null
}

/* ── Distribution Histogram ── */

function DistHistogram({
  label,
  entries,
  onChange,
  color,
  defaults,
}: {
  label: string
  entries: DistributionEntry[]
  onChange: (entries: DistributionEntry[]) => void
  color: string
  defaults: DistributionEntry[]
}) {
  const maxPct = Math.max(...entries.map(e => e.pct), 1)
  const draggingRef = useRef<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const handlePointerDown = useCallback((idx: number, e: React.PointerEvent) => {
    e.preventDefault()
    draggingRef.current = idx
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (draggingRef.current === null || !containerRef.current) return
    const idx = draggingRef.current
    const rect = containerRef.current.getBoundingClientRect()
    const barAreaTop = 0
    const barAreaHeight = rect.height - 20 // subtract label space
    const relY = e.clientY - rect.top - barAreaTop
    const rawPct = Math.max(0, Math.min(100, (1 - relY / barAreaHeight) * 100))
    const newPct = Math.round(rawPct)

    const updated = entries.map((en, i) => i === idx ? { ...en, pct: newPct } : { ...en })
    // Normalize to 100%
    const total = updated.reduce((s, en) => s + en.pct, 0)
    if (total > 0) {
      const normalized = updated.map(en => ({ ...en, pct: Math.round(en.pct / total * 100) }))
      // Fix rounding: add remainder to the adjusted bar
      const normTotal = normalized.reduce((s, en) => s + en.pct, 0)
      if (normTotal !== 100 && normalized.length > 0) {
        normalized[idx].pct += 100 - normTotal
      }
      onChange(normalized)
    }
  }, [entries, onChange])

  const handlePointerUp = useCallback(() => {
    draggingRef.current = null
  }, [])

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[9px] text-gray-400 uppercase tracking-wider font-semibold">{label}</p>
        <button
          onClick={() => onChange(defaults)}
          className="text-[8px] text-gray-300 hover:text-gray-500 transition-colors"
          title="Reset to defaults"
        >
          reset
        </button>
      </div>
      <div
        ref={containerRef}
        className="flex items-end gap-px h-[60px] touch-none"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {entries.map((entry, i) => {
          const h = Math.max(2, (entry.pct / maxPct) * 100)
          return (
            <div key={entry.hour} className="flex-1 flex flex-col items-center gap-0.5 min-w-0">
              <div className="w-full relative flex items-end" style={{ height: 44 }}>
                <div
                  className="w-full rounded-t-sm cursor-ns-resize transition-[height] duration-75"
                  style={{ height: `${h}%`, backgroundColor: color, opacity: 0.7, minHeight: 2 }}
                  onPointerDown={(e) => handlePointerDown(i, e)}
                  title={`${entry.hour}:00 — ${entry.pct}%`}
                />
              </div>
              <span className="text-[8px] text-gray-400 font-mono tabular-nums leading-none">{entry.hour}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── Segment Bar (battery mix / charge power mix) ── */

function SegmentBar({
  segments,
  onChange,
}: {
  segments: { label: string; value: number; color: string }[]
  onChange: (values: number[]) => void
}) {
  const total = segments.reduce((s, seg) => s + seg.value, 0)
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef<number | null>(null)

  const handlePointerDown = useCallback((dividerIdx: number, e: React.PointerEvent) => {
    e.preventDefault()
    draggingRef.current = dividerIdx
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (draggingRef.current === null || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const relX = (e.clientX - rect.left) / rect.width
    const pctAtPointer = Math.round(relX * 100)
    const divIdx = draggingRef.current

    const values = segments.map(s => s.value)
    // Sum of segments before divider
    const sumBefore = values.slice(0, divIdx).reduce((s, v) => s + v, 0)
    const sumAfterAndCurrent = total - sumBefore

    const newLeft = Math.max(0, Math.min(sumAfterAndCurrent, pctAtPointer - sumBefore))
    const newRight = sumAfterAndCurrent - newLeft

    values[divIdx] = newLeft
    values[divIdx + 1] = newRight
    // Keep other segments unchanged, normalize total to 100
    const newTotal = values.reduce((s, v) => s + v, 0)
    if (newTotal > 0) {
      const normalized = values.map(v => Math.round(v / newTotal * 100))
      const normTotal = normalized.reduce((s, v) => s + v, 0)
      if (normTotal !== 100) normalized[divIdx] += 100 - normTotal
      onChange(normalized)
    }
  }, [segments, total, onChange])

  const handlePointerUp = useCallback(() => {
    draggingRef.current = null
  }, [])

  return (
    <div
      ref={containerRef}
      className="flex h-5 rounded-full overflow-hidden touch-none"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {segments.map((seg, i) => (
        <div key={seg.label} className="relative flex items-center justify-center" style={{ width: `${seg.value}%`, backgroundColor: seg.color }}>
          {seg.value >= 15 && (
            <span className="text-[8px] font-bold text-white/90 whitespace-nowrap pointer-events-none">
              {seg.label} {seg.value}%
            </span>
          )}
          {/* Divider handle between segments */}
          {i < segments.length - 1 && (
            <div
              className="absolute right-0 top-0 bottom-0 w-3 cursor-ew-resize z-10 flex items-center justify-center"
              style={{ transform: 'translateX(50%)' }}
              onPointerDown={(e) => handlePointerDown(i, e)}
            >
              <div className="w-0.5 h-3 bg-white/80 rounded-full" />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/* ── Main Panel ── */

export function FleetConfigPanel({ config, onChange, optimizationResult }: Props) {
  // Log slider: 10 → 1,000
  const logMin = Math.log10(10)
  const logMax = Math.log10(1000)
  const logToFleet = (v: number) => Math.round(Math.pow(10, v))
  const fleetToLog = (f: number) => Math.log10(Math.max(10, f))

  const handleFleetSize = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...config, fleetSize: logToFleet(parseFloat(e.target.value)) })
  }, [config, onChange])

  const handleBatteryMix = useCallback((values: number[]) => {
    onChange({ ...config, batteryMix: { compact: values[0], mid: values[1], suv: values[2] } })
  }, [config, onChange])

  const handlePowerMix = useCallback((values: number[]) => {
    onChange({ ...config, chargePowerMix: { kw7: values[0], kw11: values[1] } })
  }, [config, onChange])

  const res = optimizationResult

  return (
    <div className="border-t border-gray-100 pt-3 mt-1 space-y-3">
      {/* Row 1: Fleet size */}
      <div className="flex items-center gap-3">
        <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold w-14 shrink-0">Fleet</span>
        <input
          type="range"
          min={logMin}
          max={logMax}
          step={0.01}
          value={fleetToLog(config.fleetSize)}
          onChange={handleFleetSize}
          className="flex-1 h-1 accent-[#313131]"
        />
        <span className="text-[13px] font-bold text-[#313131] tabular-nums w-16 text-right">{config.fleetSize} EVs</span>
      </div>

      {/* Row 2: Arrival + Departure distributions */}
      <div className="flex gap-4">
        <DistHistogram
          label="Arrival (14–23h)"
          entries={config.arrivalDist}
          onChange={(arrivalDist) => onChange({ ...config, arrivalDist })}
          color="#3B82F6"
          defaults={DEFAULT_ARRIVAL_DIST}
        />
        <DistHistogram
          label="Departure (5–9h)"
          entries={config.departureDist}
          onChange={(departureDist) => onChange({ ...config, departureDist })}
          color="#8B5CF6"
          defaults={DEFAULT_DEPARTURE_DIST}
        />
      </div>

      {/* Row 3: Battery mix + charge power */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[9px] text-gray-400 uppercase tracking-wider mb-1 font-semibold">Battery mix</p>
          <SegmentBar
            segments={[
              { label: '40kWh', value: config.batteryMix.compact, color: '#6EE7B7' },
              { label: '60kWh', value: config.batteryMix.mid, color: '#34D399' },
              { label: '100kWh', value: config.batteryMix.suv, color: '#059669' },
            ]}
            onChange={handleBatteryMix}
          />
        </div>
        <div>
          <p className="text-[9px] text-gray-400 uppercase tracking-wider mb-1 font-semibold">Charge power</p>
          <SegmentBar
            segments={[
              { label: '7 kW', value: config.chargePowerMix.kw7, color: '#60A5FA' },
              { label: '11 kW', value: config.chargePowerMix.kw11, color: '#2563EB' },
            ]}
            onChange={handlePowerMix}
          />
        </div>
      </div>

      {/* Row 4: SoC spread */}
      <div className="flex items-center gap-3">
        <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold w-14 shrink-0">SoC</span>
        <div className="flex-1 flex items-center gap-2">
          <span className="text-[10px] text-gray-500 tabular-nums w-8">{config.socMin}%</span>
          <input
            type="range"
            min={10}
            max={60}
            value={config.socMin}
            onChange={(e) => {
              const v = parseInt(e.target.value)
              onChange({ ...config, socMin: Math.min(v, config.socMax) })
            }}
            className="flex-1 h-1 accent-gray-500"
          />
          <input
            type="range"
            min={10}
            max={60}
            value={config.socMax}
            onChange={(e) => {
              const v = parseInt(e.target.value)
              onChange({ ...config, socMax: Math.max(v, config.socMin) })
            }}
            className="flex-1 h-1 accent-gray-500"
          />
          <span className="text-[10px] text-gray-500 tabular-nums w-8 text-right">{config.socMax}%</span>
        </div>
      </div>

      {/* KPI Row (PROJ-37) — shown when optimization result is available */}
      {res && (
        <div className="border-t border-gray-100 pt-2.5 mt-1">
          {res.shortfallKwh > 0 && (
            <p className="text-[10px] text-amber-600 font-semibold mb-2">
              Insufficient charging capacity — {res.shortfallKwh.toFixed(0)} kWh shortfall
            </p>
          )}
          <div className="grid grid-cols-5 gap-2">
            <div>
              <p className="text-[8px] text-gray-400 uppercase tracking-wide">Fleet</p>
              <p className="text-[13px] font-bold text-[#313131] tabular-nums">
                {config.fleetSize}<span className="text-[9px] font-normal text-gray-400 ml-0.5">EVs</span>
              </p>
              <p className="text-[8px] text-gray-400 tabular-nums">{res.totalEnergyKwh.toFixed(0)} kWh</p>
            </div>
            <div>
              <p className="text-[8px] text-gray-400 uppercase tracking-wide">Baseline</p>
              <p className="text-[13px] font-bold text-red-500 tabular-nums">
                {res.baselineCostEur.toFixed(2)}<span className="text-[9px] font-normal text-gray-400 ml-0.5">EUR</span>
              </p>
              <p className="text-[8px] text-gray-400 tabular-nums">{res.baselineAvgCtKwh.toFixed(1)} ct/kWh</p>
            </div>
            <div>
              <p className="text-[8px] text-gray-400 uppercase tracking-wide">Optimized</p>
              <p className="text-[13px] font-bold text-emerald-600 tabular-nums">
                {res.optimizedCostEur.toFixed(2)}<span className="text-[9px] font-normal text-gray-400 ml-0.5">EUR</span>
              </p>
              <p className="text-[8px] text-gray-400 tabular-nums">{res.optimizedAvgCtKwh.toFixed(1)} ct/kWh</p>
            </div>
            <div>
              <p className="text-[8px] text-gray-400 uppercase tracking-wide">Savings</p>
              <p className="text-[13px] font-bold text-emerald-600 tabular-nums">
                {res.savingsEur.toFixed(2)}<span className="text-[9px] font-normal text-gray-400 ml-0.5">EUR</span>
              </p>
              <p className="text-[8px] text-emerald-500 font-semibold tabular-nums">{res.savingsPct.toFixed(1)}%</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

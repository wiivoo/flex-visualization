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
    const barAreaHeight = rect.height - 20
    const relY = e.clientY - rect.top
    const rawPct = Math.max(0, Math.min(100, (1 - relY / barAreaHeight) * 100))
    const newPct = Math.round(rawPct)

    const updated = entries.map((en, i) => i === idx ? { ...en, pct: newPct } : { ...en })
    const total = updated.reduce((s, en) => s + en.pct, 0)
    if (total > 0) {
      const normalized = updated.map(en => ({ ...en, pct: Math.round(en.pct / total * 100) }))
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

/* ── Main Panel ── */

export function FleetConfigPanel({ config, onChange, optimizationResult }: Props) {
  const res = optimizationResult

  return (
    <div className="space-y-3">
      {/* Row 1: Arrival + Departure distributions — same color */}
      <div className="flex gap-4">
        <DistHistogram
          label="Arrival (14–23h)"
          entries={config.arrivalDist}
          onChange={(arrivalDist) => onChange({ ...config, arrivalDist })}
          color="#6B7280"
          defaults={DEFAULT_ARRIVAL_DIST}
        />
        <DistHistogram
          label="Departure (5–9h)"
          entries={config.departureDist}
          onChange={(departureDist) => onChange({ ...config, departureDist })}
          color="#6B7280"
          defaults={DEFAULT_DEPARTURE_DIST}
        />
      </div>

      {/* Row 2: Charge need per session — how much each car needs */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <span className="text-[9px] text-gray-400 uppercase tracking-wider font-semibold">Charge need</span>
          <span className="text-[13px] font-bold text-[#313131] tabular-nums">
            {config.socMin}–{config.socMax}
            <span className="text-[9px] font-normal text-gray-400 ml-0.5">kWh/session</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-gray-400 tabular-nums w-6">{config.socMin}</span>
          <input
            type="range"
            min={5}
            max={50}
            value={config.socMin}
            onChange={(e) => {
              const v = parseInt(e.target.value)
              onChange({ ...config, socMin: Math.min(v, config.socMax) })
            }}
            className="flex-1 h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white"
          />
          <input
            type="range"
            min={5}
            max={50}
            value={config.socMax}
            onChange={(e) => {
              const v = parseInt(e.target.value)
              onChange({ ...config, socMax: Math.max(v, config.socMin) })
            }}
            className="flex-1 h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white"
          />
          <span className="text-[9px] text-gray-400 tabular-nums w-6 text-right">{config.socMax}</span>
        </div>
        <p className="text-[9px] text-gray-400 text-center">
          Spread of kWh each car needs per overnight session
        </p>
      </div>

      {/* KPI Row — shown when optimization result is available */}
      {res && (
        <div className="border-t border-gray-100 pt-2.5 mt-1">
          {res.shortfallKwh > 0 && (
            <p className="text-[10px] text-amber-600 font-semibold mb-2">
              Insufficient capacity — {res.shortfallKwh.toFixed(0)} kWh shortfall
            </p>
          )}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            <div>
              <p className="text-[8px] text-gray-400 uppercase tracking-wide">Baseline (charge ASAP)</p>
              <p className="text-[13px] font-bold text-red-500 tabular-nums">
                {res.baselineCostEur.toFixed(2)}<span className="text-[9px] font-normal text-gray-400 ml-0.5">EUR</span>
              </p>
              <p className="text-[8px] text-gray-400 tabular-nums">{res.baselineAvgCtKwh.toFixed(1)} ct/kWh · {res.totalEnergyKwh.toFixed(0)} kWh</p>
            </div>
            <div>
              <p className="text-[8px] text-gray-400 uppercase tracking-wide">Optimized</p>
              <p className="text-[13px] font-bold text-emerald-600 tabular-nums">
                {res.optimizedCostEur.toFixed(2)}<span className="text-[9px] font-normal text-gray-400 ml-0.5">EUR</span>
              </p>
              <p className="text-[8px] text-gray-400 tabular-nums">{res.optimizedAvgCtKwh.toFixed(1)} ct/kWh</p>
            </div>
            <div className="col-span-2 flex items-center justify-between pt-1 border-t border-gray-50">
              <span className="text-[9px] text-gray-400 uppercase tracking-wide">Savings (1,000 EVs)</span>
              <span className="text-[13px] font-bold text-emerald-600 tabular-nums">
                {res.savingsEur.toFixed(2)} EUR
                <span className="text-[9px] font-normal text-emerald-500 ml-1">({res.savingsPct.toFixed(1)}%)</span>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import { useCallback, useRef } from 'react'
import type { FleetConfig, SpreadMode } from '@/lib/v2-config'

interface Props {
  config: FleetConfig
  onChange: (config: FleetConfig) => void
  mode?: 'overnight' | 'fullday' | 'threeday'
}

const SLIDER_CLASS = "w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white"

/* ── Draggable triangle marker ── */
function TriangleMarker({
  value, sliderMin, sliderMax, onChange, side,
}: {
  value: number; sliderMin: number; sliderMax: number
  onChange: (v: number) => void; side: 'min' | 'max'
}) {
  const frac = (value - sliderMin) / (sliderMax - sliderMin)
  // Match HTML range input thumb positioning: thumb center offset by 8px (half of 16px thumb)
  // at 0% it's at 8px from left, at 100% it's at (width - 8px)
  const dragging = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    dragging.current = true
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current || !containerRef.current) return
    const parent = containerRef.current.parentElement
    if (!parent) return
    const rect = parent.getBoundingClientRect()
    // Account for 8px thumb offset on each side
    const thumbOffset = 8
    const trackWidth = rect.width - thumbOffset * 2
    const relX = (e.clientX - rect.left - thumbOffset) / trackWidth
    const raw = Math.round(sliderMin + Math.max(0, Math.min(1, relX)) * (sliderMax - sliderMin))
    onChange(Math.max(sliderMin, Math.min(sliderMax, raw)))
  }, [sliderMin, sliderMax, onChange])

  const handlePointerUp = useCallback(() => { dragging.current = false }, [])

  // Position: aligned with slider thumb (8px offset for 16px thumb)
  // top: 2px puts triangle just above the slider track inside pt-3 container
  return (
    <div
      ref={containerRef}
      className="absolute touch-none cursor-ew-resize"
      style={{ left: `calc(8px + ${frac} * (100% - 16px) - 5px)`, top: 0, width: 10, height: 8, zIndex: 1 }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      title={`${side === 'min' ? 'Min' : 'Max'}: ${value}`}
    >
      <svg width="10" height="8" viewBox="0 0 10 8" className="drop-shadow-sm">
        <polygon points="5,8 0,0 10,0" fill="#9CA3AF" />
      </svg>
    </div>
  )
}

/* ── Range slider with triangle min/max markers ── */
function RangeSlider({
  label, unit, avg, min, max, sliderMin, sliderMax, step,
  onAvgChange, onMinChange, onMaxChange,
}: {
  label: string; unit: string
  avg: number; min: number; max: number
  sliderMin: number; sliderMax: number; step?: number
  onAvgChange: (v: number) => void
  onMinChange: (v: number) => void
  onMaxChange: (v: number) => void
}) {
  const fracMin = (min - sliderMin) / (sliderMax - sliderMin)
  const fracMax = (max - sliderMin) / (sliderMax - sliderMin)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between h-8">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
        <span className="text-2xl font-bold text-[#313131] tabular-nums">
          {avg}<span className="text-xs font-normal text-gray-400 ml-1">{unit}</span>
        </span>
      </div>
      <div className="relative pt-[9px]">
        {/* Triangle markers just above the slider */}
        <TriangleMarker value={min} sliderMin={sliderMin} sliderMax={sliderMax}
          onChange={(v) => onMinChange(Math.min(v, avg))} side="min" />
        <TriangleMarker value={max} sliderMin={sliderMin} sliderMax={sliderMax}
          onChange={(v) => onMaxChange(Math.max(v, avg))} side="max" />
        {/* Range highlight bar between min and max */}
        <div className="absolute top-[13px] h-1.5 bg-gray-300/30 rounded-full pointer-events-none"
          style={{ left: `calc(8px + ${fracMin} * (100% - 16px))`, width: `calc(${fracMax - fracMin} * (100% - 16px))` }} />
        {/* Main avg slider — z-10 so thumb is above triangles */}
        <input type="range" min={sliderMin} max={sliderMax} step={step ?? 1}
          value={avg} onChange={(e) => onAvgChange(Number(e.target.value))}
          className={`${SLIDER_CLASS} relative z-10`} />
      </div>
      <div className="flex justify-between text-[10px] text-gray-400 -mt-1">
        <span>{sliderMin}{unit === ':00' ? ':00' : ` ${unit}`}</span>
        {min !== max && (
          <span className="text-gray-300 tabular-nums">{min}–{max} {unit === ':00' ? '' : unit}</span>
        )}
        <span>{sliderMax}{unit === ':00' ? ':00' : ` ${unit}`}</span>
      </div>
    </div>
  )
}

/* ── Main Panel ── */

export function FleetConfigPanel({ config, onChange, mode = 'overnight' }: Props) {
  const spread = config.spreadMode
  // Departure slider adapts to mode:
  // 12h overnight: 5–9h (next morning)
  // 24h fullday: 14–23h (next afternoon/evening — same as arrival range)
  // 72h threeday: 5–9h (morning of day 4)
  const isFullDay = mode === 'fullday'
  const depSliderMin = isFullDay ? 14 : 5
  const depSliderMax = isFullDay ? 23 : 9
  const depLabel = isFullDay ? 'Departure Time (day+1)' : mode === 'threeday' ? 'Departure Time (day+3)' : 'Departure Time (day+1)'

  return (
    <div className="space-y-4">
      {/* Yearly Mileage per EV */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between h-8">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Yearly Mileage per EV</span>
          <span className="text-2xl font-bold text-[#313131] tabular-nums">
            {(config.yearlyMileageKm ?? 12000).toLocaleString('en-US')}<span className="text-xs font-normal text-gray-400 ml-1">km</span>
          </span>
        </div>
        <div>
          <input type="range" min={5000} max={40000} step={1000}
            value={config.yearlyMileageKm ?? 12000}
            onChange={(e) => onChange({ ...config, yearlyMileageKm: Number(e.target.value) })}
            className={SLIDER_CLASS} />
          <div className="flex justify-between text-[10px] text-gray-400 mt-1">
            <span>5,000 km</span>
            <span>40,000 km</span>
          </div>
        </div>
      </div>

      {/* Weekly Plug-ins per EV */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between h-8">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Weekly Plug-ins per EV</span>
          <span className="text-2xl font-bold text-[#313131] tabular-nums">
            {config.plugInsPerWeek ?? 3}<span className="text-xs font-normal text-gray-400 ml-1">x / wk</span>
          </span>
        </div>
        <div>
          <input type="range" min={1} max={7} step={1}
            value={config.plugInsPerWeek ?? 3}
            onChange={(e) => onChange({ ...config, plugInsPerWeek: Number(e.target.value) })}
            className={SLIDER_CLASS} />
          <div className="flex justify-between text-[10px] text-gray-400 mt-1">
            <span>1x</span>
            <span>7x</span>
          </div>
        </div>
        <p className="text-[10px] text-gray-400 text-center">
          {Math.round((config.yearlyMileageKm ?? 12000) / ((config.plugInsPerWeek ?? 3) * 52) / 100 * 19 * 10) / 10} kWh/session · {(config.plugInsPerWeek ?? 3) * 52} sessions/yr per EV
        </p>
      </div>

      {/* Arrival Time */}
      <RangeSlider
        label="Arrival Time" unit=":00"
        avg={config.arrivalAvg} min={config.arrivalMin} max={config.arrivalMax}
        sliderMin={14} sliderMax={23}
        onAvgChange={(v) => onChange({ ...config, arrivalAvg: v, arrivalMin: Math.min(config.arrivalMin, v), arrivalMax: Math.max(config.arrivalMax, v) })}
        onMinChange={(v) => onChange({ ...config, arrivalMin: v })}
        onMaxChange={(v) => onChange({ ...config, arrivalMax: v })}
      />

      {/* Departure Time — adapts range to charging mode */}
      <RangeSlider
        label={depLabel} unit=":00"
        avg={Math.max(depSliderMin, Math.min(depSliderMax, config.departureAvg))}
        min={Math.max(depSliderMin, Math.min(depSliderMax, config.departureMin))}
        max={Math.max(depSliderMin, Math.min(depSliderMax, config.departureMax))}
        sliderMin={depSliderMin} sliderMax={depSliderMax}
        onAvgChange={(v) => onChange({ ...config, departureAvg: v, departureMin: Math.min(config.departureMin, v), departureMax: Math.max(config.departureMax, v) })}
        onMinChange={(v) => onChange({ ...config, departureMin: v })}
        onMaxChange={(v) => onChange({ ...config, departureMax: v })}
      />

      {/* Spread */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Fleet Spread</span>
        <div className="flex items-center gap-0.5 bg-gray-100 rounded-full p-0.5">
          {(['off', 'narrow', 'normal', 'wide'] as SpreadMode[]).map(mode => (
            <button key={mode}
              onClick={() => onChange({ ...config, spreadMode: mode })}
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full transition-colors capitalize ${
                spread === mode ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'
              }`}
            >{mode}</button>
          ))}
        </div>
      </div>

      {/* Charge power */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Charge Power</span>
        <div className="flex items-center gap-0.5 bg-gray-100 rounded-full p-0.5">
          <button
            onClick={() => onChange({ ...config, chargePowerKw: 7 })}
            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full transition-colors ${config.chargePowerKw === 7 ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
          >7 kW</button>
          <button
            onClick={() => onChange({ ...config, chargePowerKw: 11 })}
            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full transition-colors ${config.chargePowerKw === 11 ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
          >11 kW</button>
        </div>
      </div>

      {/* Fleet size note */}
      <p className="text-[9px] text-gray-400 text-center pt-1 border-t border-gray-100">
        Fleet of 1,000 EVs · ~{Math.round(1000 * Math.min(1, (config.plugInsPerWeek ?? 3) / 7))} charging per night · per-EV savings
      </p>
    </div>
  )
}

'use client'

import type { FleetConfig, SpreadMode } from '@/lib/v2-config'

interface Props {
  config: FleetConfig
  onChange: (config: FleetConfig) => void
}

const SLIDER_CLASS = "w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white"
const HOOK_CLASS = "w-full h-1 bg-transparent rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:h-2 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gray-300 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-gray-200"

/* ── Range slider with subtle min/max hooks ── */
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
  const pctMin = ((min - sliderMin) / (sliderMax - sliderMin)) * 100
  const pctMax = ((max - sliderMin) / (sliderMax - sliderMin)) * 100

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between h-8">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
        <span className="text-2xl font-bold text-[#313131] tabular-nums">
          {avg}<span className="text-xs font-normal text-gray-400 ml-1">{unit}</span>
        </span>
      </div>
      <div className="relative">
        {/* Range highlight bar */}
        <div className="absolute top-[5px] h-1 bg-gray-300/40 rounded-full pointer-events-none"
          style={{ left: `${pctMin}%`, width: `${pctMax - pctMin}%` }} />
        {/* Main avg slider */}
        <input type="range" min={sliderMin} max={sliderMax} step={step ?? 1}
          value={avg} onChange={(e) => onAvgChange(Number(e.target.value))}
          className={SLIDER_CLASS} />
        {/* Min hook — subtle, overlaid */}
        <input type="range" min={sliderMin} max={sliderMax} step={step ?? 1}
          value={min} onChange={(e) => onMinChange(Math.min(Number(e.target.value), avg))}
          className={`${HOOK_CLASS} absolute top-[3px] left-0`} />
        {/* Max hook — subtle, overlaid */}
        <input type="range" min={sliderMin} max={sliderMax} step={step ?? 1}
          value={max} onChange={(e) => onMaxChange(Math.max(Number(e.target.value), avg))}
          className={`${HOOK_CLASS} absolute top-[3px] left-0`} />
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

export function FleetConfigPanel({ config, onChange }: Props) {
  const spread = config.spreadMode

  return (
    <div className="space-y-4">
      {/* Arrival */}
      <RangeSlider
        label="Avg Arrival" unit=":00"
        avg={config.arrivalAvg} min={config.arrivalMin} max={config.arrivalMax}
        sliderMin={14} sliderMax={23}
        onAvgChange={(v) => onChange({ ...config, arrivalAvg: v, arrivalMin: Math.min(config.arrivalMin, v), arrivalMax: Math.max(config.arrivalMax, v) })}
        onMinChange={(v) => onChange({ ...config, arrivalMin: v })}
        onMaxChange={(v) => onChange({ ...config, arrivalMax: v })}
      />

      {/* Departure */}
      <RangeSlider
        label="Avg Departure" unit=":00"
        avg={config.departureAvg} min={config.departureMin} max={config.departureMax}
        sliderMin={5} sliderMax={9}
        onAvgChange={(v) => onChange({ ...config, departureAvg: v, departureMin: Math.min(config.departureMin, v), departureMax: Math.max(config.departureMax, v) })}
        onMinChange={(v) => onChange({ ...config, departureMin: v })}
        onMaxChange={(v) => onChange({ ...config, departureMax: v })}
      />

      {/* Charge Need */}
      <RangeSlider
        label="Avg Charge Need" unit="kWh"
        avg={config.chargeNeedAvg} min={config.chargeNeedMin} max={config.chargeNeedMax}
        sliderMin={3} sliderMax={45}
        onAvgChange={(v) => {
          const spread = Math.round(v * 0.4)
          onChange({ ...config, chargeNeedAvg: v, chargeNeedMin: Math.max(3, v - spread), chargeNeedMax: Math.min(45, v + spread) })
        }}
        onMinChange={(v) => onChange({ ...config, chargeNeedMin: v })}
        onMaxChange={(v) => onChange({ ...config, chargeNeedMax: v })}
      />

      {/* Spread mode toggle */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Distribution</span>
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

      {/* KPIs are shown in the 12h scenario card, not here */}
    </div>
  )
}

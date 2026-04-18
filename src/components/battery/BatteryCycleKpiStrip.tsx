'use client'

import { Card, CardContent } from '@/components/ui/card'
import type { BatteryVariant } from '@/lib/battery-config'
import type { BatteryWindowHours, BatteryWindowSummary } from '@/lib/use-battery-window'

interface Props {
  summary: BatteryWindowSummary | null
  variant: BatteryVariant
  windowHours: BatteryWindowHours
  setWindowHours: (hours: BatteryWindowHours) => void
}

const WINDOW_OPTIONS: BatteryWindowHours[] = [24, 36, 72]

export function BatteryCycleKpiStrip({ summary, variant, windowHours, setWindowHours }: Props) {
  const savingsEur = summary?.savingsEur ?? 0
  const savingsPositive = savingsEur >= 0
  const avgWith = summary?.batteryAvgCt ?? 0
  const avgWithout = summary?.baselineAvgCt ?? 0
  const fullCycles = summary?.fullCycles ?? 0
  const cycleEnergyKwh = fullCycles * variant.usableKwh
  const gridBaseline = summary?.gridWithoutBatteryKwh ?? 0
  const gridWith = summary?.gridWithBatteryKwh ?? 0
  const gridDelta = gridWith - gridBaseline

  return (
    <Card className="shadow-sm border-gray-200/80">
      <CardContent className="px-4 py-3">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              Cycle window summary
            </p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              All numbers below are totals across the active {windowHours}-hour cycle window for the {variant.shortLabel}.
            </p>
          </div>
          <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5 flex-shrink-0">
            {WINDOW_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setWindowHours(opt)}
                className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full transition-colors ${
                  windowHours === opt
                    ? 'bg-white text-[#313131] shadow-sm'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                {opt}h
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Savings */}
          <div className={`rounded-lg border px-3 py-2 ${savingsPositive ? 'border-emerald-200 bg-emerald-50/50' : 'border-red-200 bg-red-50/50'}`}>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-500">
              Savings vs no battery
            </p>
            <p className={`text-[20px] font-bold tabular-nums leading-tight mt-0.5 ${savingsPositive ? 'text-emerald-700' : 'text-red-700'}`}>
              {savingsPositive ? '+' : ''}{savingsEur.toFixed(2)} €
            </p>
            <p className="text-[10px] text-gray-500 tabular-nums mt-0.5">
              {avgWith.toFixed(1)} vs {avgWithout.toFixed(1)} ct/kWh
            </p>
          </div>

          {/* Full cycles */}
          <div className="rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-500">
              Full-equivalent cycles
            </p>
            <p className="text-[20px] font-bold tabular-nums leading-tight text-[#313131] mt-0.5">
              {fullCycles.toFixed(2)}
            </p>
            <p className="text-[10px] text-gray-500 tabular-nums mt-0.5">
              {cycleEnergyKwh.toFixed(1)} kWh charged · {variant.usableKwh.toFixed(1)} kWh / cycle
            </p>
          </div>

          {/* Grid draw shifted */}
          <div className="rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-500">
              Grid draw shifted
            </p>
            <p className="text-[20px] font-bold tabular-nums leading-tight text-blue-700 mt-0.5">
              {summary?.gridDisplacedKwh.toFixed(1) ?? '0.0'} kWh
            </p>
            <p className="text-[10px] text-gray-500 tabular-nums mt-0.5">
              battery covered load at peak
            </p>
          </div>

          {/* Net grid draw */}
          <div className="rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-500">
              Net grid draw
            </p>
            <p className="text-[20px] font-bold tabular-nums leading-tight text-[#313131] mt-0.5">
              {gridWith.toFixed(1)} kWh
            </p>
            <p className="text-[10px] text-gray-500 tabular-nums mt-0.5">
              {gridDelta >= 0 ? '+' : ''}{gridDelta.toFixed(1)} vs {gridBaseline.toFixed(1)} kWh baseline
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

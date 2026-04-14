'use client'

import { Card, CardContent } from '@/components/ui/card'
import type { PinnedDefaults } from '@/lib/insights-sweep'
import { AVG_CONSUMPTION_KWH_PER_100KM } from '@/lib/v2-config'

interface Props {
  pinned: PinnedDefaults
  setPinned: (p: PinnedDefaults) => void
  onReset: () => void
}

const POWER_OPTIONS = [3.7, 7, 11, 22]

export function InsightsControls({ pinned, setPinned, onReset }: Props) {
  const update = <K extends keyof PinnedDefaults>(key: K, value: PinnedDefaults[K]) =>
    setPinned({ ...pinned, [key]: value })

  const kwhPerYear = Math.round((pinned.yearlyMileageKm / 100) * AVG_CONSUMPTION_KWH_PER_100KM)

  return (
    <Card className="overflow-hidden shadow-sm border-gray-200/80">
      <CardContent className="pt-5 pb-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-[#313131]">Customer profile</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Move any control to update both views below.
            </p>
          </div>
          <button
            onClick={onReset}
            className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors">
            Reset to defaults
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-5">
          {/* Yearly mileage */}
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between h-8">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Mileage</span>
              <span className="text-xl font-bold text-[#313131] tabular-nums">
                {pinned.yearlyMileageKm.toLocaleString('en-US')}
                <span className="text-[10px] font-normal text-gray-400 ml-1">km/yr</span>
              </span>
            </div>
            <input
              type="range" min={5000} max={40000} step={1000}
              value={pinned.yearlyMileageKm}
              onChange={(e) => update('yearlyMileageKm', Number(e.target.value))}
              aria-label={`Yearly mileage: ${pinned.yearlyMileageKm} km`}
              className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131]
                [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer
                [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white" />
            <div className="flex justify-between text-[10px] text-gray-400">
              <span>5k</span>
              <span>40k</span>
            </div>
            <p className="text-[10px] text-gray-400 text-center">{kwhPerYear.toLocaleString('en-US')} kWh/yr</p>
          </div>

          {/* Plug-in time */}
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between h-8">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Plug-in time</span>
              <span className="text-xl font-bold text-[#313131] tabular-nums">
                {String(pinned.plugInTime).padStart(2, '0')}
                <span className="text-[10px] font-normal text-gray-400 ml-0.5">:00</span>
              </span>
            </div>
            <input
              type="range" min={14} max={22} step={1}
              value={pinned.plugInTime}
              onChange={(e) => update('plugInTime', Number(e.target.value))}
              aria-label={`Plug-in time: ${pinned.plugInTime}:00`}
              className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131]
                [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer
                [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white" />
            <div className="flex justify-between text-[10px] text-gray-400">
              <span>14:00</span>
              <span>22:00</span>
            </div>
            <p className="text-[10px] text-gray-400 text-center">when EV plugs in</p>
          </div>

          {/* Window length */}
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between h-8">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Window</span>
              <span className="text-xl font-bold text-[#313131] tabular-nums">
                {pinned.windowLengthHours}
                <span className="text-[10px] font-normal text-gray-400 ml-1">h</span>
              </span>
            </div>
            <input
              type="range" min={4} max={14} step={1}
              value={pinned.windowLengthHours}
              onChange={(e) => update('windowLengthHours', Number(e.target.value))}
              aria-label={`Window length: ${pinned.windowLengthHours}h`}
              className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131]
                [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer
                [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white" />
            <div className="flex justify-between text-[10px] text-gray-400">
              <span>4h</span>
              <span>14h</span>
            </div>
            <p className="text-[10px] text-gray-400 text-center">plug-in → departure</p>
          </div>

          {/* Plug-ins per week */}
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between h-8">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Frequency</span>
              <span className="text-xl font-bold text-[#313131] tabular-nums">
                {pinned.plugInsPerWeek}
                <span className="text-[10px] font-normal text-gray-400 ml-1">x / wk</span>
              </span>
            </div>
            <input
              type="range" min={1} max={7} step={1}
              value={pinned.plugInsPerWeek}
              onChange={(e) => update('plugInsPerWeek', Number(e.target.value))}
              aria-label={`Plug-ins per week: ${pinned.plugInsPerWeek}`}
              className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131]
                [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer
                [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white" />
            <div className="flex justify-between text-[10px] text-gray-400">
              <span>1x</span>
              <span>7x</span>
            </div>
            <p className="text-[10px] text-gray-400 text-center">charging sessions</p>
          </div>

          {/* Charge power — discrete buttons */}
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between h-8">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Charge power</span>
              <span className="text-xl font-bold text-[#313131] tabular-nums">
                {pinned.chargePowerKw}
                <span className="text-[10px] font-normal text-gray-400 ml-1">kW</span>
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {POWER_OPTIONS.map(p => {
                const active = Math.abs(p - pinned.chargePowerKw) < 0.001
                return (
                  <button
                    key={p}
                    onClick={() => update('chargePowerKw', p)}
                    className={`py-1.5 rounded text-[11px] font-semibold tabular-nums transition-colors ${
                      active ? 'bg-[#313131] text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}>
                    {p}
                  </button>
                )
              })}
            </div>
            <p className="text-[10px] text-gray-400 text-center">wallbox capacity</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

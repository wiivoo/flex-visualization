'use client'

import { Card, CardContent } from '@/components/ui/card'
import type { PinnedDefaults, FleetSweepParams } from '@/lib/insights-sweep'
import { AVG_CONSUMPTION_KWH_PER_100KM } from '@/lib/v2-config'

interface Props {
  mode: 'single' | 'fleet'
  pinned: PinnedDefaults
  setPinned: (p: PinnedDefaults) => void
  fleet: FleetSweepParams
  setFleet: (f: FleetSweepParams) => void
  onReset: () => void
}

const POWER_OPTIONS = [3.7, 7, 11, 22]
const SPREAD_OPTIONS: FleetSweepParams['spreadMode'][] = ['off', 'narrow', 'normal', 'wide']

export function InsightsControls({ mode, pinned, setPinned, fleet, setFleet, onReset }: Props) {
  const update = <K extends keyof PinnedDefaults>(key: K, value: PinnedDefaults[K]) =>
    setPinned({ ...pinned, [key]: value })
  const updateFleet = <K extends keyof FleetSweepParams>(key: K, value: FleetSweepParams[K]) =>
    setFleet({ ...fleet, [key]: value })

  const kwhPerYear = Math.round((pinned.yearlyMileageKm / 100) * AVG_CONSUMPTION_KWH_PER_100KM)

  if (mode === 'fleet') {
    return <FleetControls fleet={fleet} updateFleet={updateFleet} onReset={onReset} />
  }

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

/* ── Fleet controls ─────────────────────────────────────────────────────── */

interface FleetCtrlProps {
  fleet: FleetSweepParams
  updateFleet: <K extends keyof FleetSweepParams>(key: K, value: FleetSweepParams[K]) => void
  onReset: () => void
}

function FleetControls({ fleet, updateFleet, onReset }: FleetCtrlProps) {
  // Clamp helpers so min ≤ avg ≤ max stays consistent
  const setArr = (field: 'arrivalMin' | 'arrivalMax' | 'arrivalAvg', v: number) => {
    const next = { ...fleet, [field]: v }
    if (next.arrivalMin > next.arrivalMax) next.arrivalMax = next.arrivalMin
    if (next.arrivalAvg < next.arrivalMin) next.arrivalAvg = next.arrivalMin
    if (next.arrivalAvg > next.arrivalMax) next.arrivalAvg = next.arrivalMax
    updateFleet(field, v)
    if (next.arrivalMax !== fleet.arrivalMax) updateFleet('arrivalMax', next.arrivalMax)
    if (next.arrivalAvg !== fleet.arrivalAvg) updateFleet('arrivalAvg', next.arrivalAvg)
  }
  const setDep = (field: 'departureMin' | 'departureMax' | 'departureAvg', v: number) => {
    const next = { ...fleet, [field]: v }
    if (next.departureMin > next.departureMax) next.departureMax = next.departureMin
    if (next.departureAvg < next.departureMin) next.departureAvg = next.departureMin
    if (next.departureAvg > next.departureMax) next.departureAvg = next.departureMax
    updateFleet(field, v)
    if (next.departureMax !== fleet.departureMax) updateFleet('departureMax', next.departureMax)
    if (next.departureAvg !== fleet.departureAvg) updateFleet('departureAvg', next.departureAvg)
  }
  const setMil = (field: 'mileageMin' | 'mileageMax', v: number) => {
    const next = { ...fleet, [field]: v }
    if (next.mileageMin > next.mileageMax) {
      if (field === 'mileageMin') next.mileageMax = next.mileageMin
      else next.mileageMin = next.mileageMax
    }
    updateFleet(field, v)
    if (field === 'mileageMin' && next.mileageMax !== fleet.mileageMax) updateFleet('mileageMax', next.mileageMax)
    if (field === 'mileageMax' && next.mileageMin !== fleet.mileageMin) updateFleet('mileageMin', next.mileageMin)
  }

  return (
    <Card className="overflow-hidden shadow-sm border-gray-200/80">
      <CardContent className="pt-5 pb-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-[#313131]">Fleet profile</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Define how vehicles are distributed across arrival, departure, and mileage. Both
              views below aggregate the whole fleet.
            </p>
          </div>
          <button
            onClick={onReset}
            className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors">
            Reset to defaults
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* Fleet size + spread mode */}
          <div className="flex flex-col gap-3">
            <div>
              <div className="flex items-baseline justify-between h-8">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Fleet size</span>
                <span className="text-xl font-bold text-[#313131] tabular-nums">
                  {fleet.fleetSize.toLocaleString('en-US')}
                  <span className="text-[10px] font-normal text-gray-400 ml-1">vehicles</span>
                </span>
              </div>
              <input
                type="range" min={10} max={5000} step={10}
                value={fleet.fleetSize}
                onChange={e => updateFleet('fleetSize', Number(e.target.value))}
                className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131]
                  [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer
                  [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white" />
            </div>

            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1 block">
                Distribution shape
              </span>
              <div className="grid grid-cols-4 gap-1">
                {SPREAD_OPTIONS.map(s => {
                  const active = fleet.spreadMode === s
                  return (
                    <button
                      key={s}
                      onClick={() => updateFleet('spreadMode', s)}
                      className={`py-1.5 rounded text-[11px] font-semibold capitalize transition-colors ${
                        active ? 'bg-[#313131] text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}>
                      {s}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1 block">
                Charge power
              </span>
              <div className="grid grid-cols-4 gap-1">
                {POWER_OPTIONS.map(p => {
                  const active = Math.abs(p - fleet.chargePowerKw) < 0.001
                  return (
                    <button
                      key={p}
                      onClick={() => updateFleet('chargePowerKw', p)}
                      className={`py-1.5 rounded text-[11px] font-semibold tabular-nums transition-colors ${
                        active ? 'bg-[#313131] text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}>
                      {p}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Arrival distribution */}
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between h-8">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Arrival</span>
              <span className="text-xl font-bold text-[#313131] tabular-nums">
                {String(fleet.arrivalAvg).padStart(2, '0')}:00
              </span>
            </div>
            <RangeWithBounds
              label="avg"
              min={14} max={23}
              minValue={fleet.arrivalMin}
              maxValue={fleet.arrivalMax}
              avgValue={fleet.arrivalAvg}
              onChangeMin={v => setArr('arrivalMin', v)}
              onChangeMax={v => setArr('arrivalMax', v)}
              onChangeAvg={v => setArr('arrivalAvg', v)}
              format={v => `${String(v).padStart(2, '0')}:00`}
            />
            <p className="text-[10px] text-gray-400 text-center">earliest → latest plug-in</p>
          </div>

          {/* Departure distribution */}
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between h-8">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Departure</span>
              <span className="text-xl font-bold text-[#313131] tabular-nums">
                {String(fleet.departureAvg).padStart(2, '0')}:00
              </span>
            </div>
            <RangeWithBounds
              label="avg"
              min={4} max={11}
              minValue={fleet.departureMin}
              maxValue={fleet.departureMax}
              avgValue={fleet.departureAvg}
              onChangeMin={v => setDep('departureMin', v)}
              onChangeMax={v => setDep('departureMax', v)}
              onChangeAvg={v => setDep('departureAvg', v)}
              format={v => `${String(v).padStart(2, '0')}:00`}
            />
            <p className="text-[10px] text-gray-400 text-center">earliest → latest unplug</p>
          </div>

          {/* Mileage range */}
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between h-8">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Mileage</span>
              <span className="text-xl font-bold text-[#313131] tabular-nums">
                {(fleet.mileageMin / 1000).toFixed(0)}–{(fleet.mileageMax / 1000).toFixed(0)}k
                <span className="text-[10px] font-normal text-gray-400 ml-1">km/yr</span>
              </span>
            </div>
            <input
              type="range" min={5000} max={40000} step={1000}
              value={fleet.mileageMin}
              onChange={e => setMil('mileageMin', Number(e.target.value))}
              className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131]
                [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer
                [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white" />
            <input
              type="range" min={5000} max={40000} step={1000}
              value={fleet.mileageMax}
              onChange={e => setMil('mileageMax', Number(e.target.value))}
              className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131]
                [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer
                [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white" />
            <p className="text-[10px] text-gray-400 text-center">low → high range</p>
          </div>

          {/* Frequency */}
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between h-8">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Frequency</span>
              <span className="text-xl font-bold text-[#313131] tabular-nums">
                {fleet.plugInsPerWeek}
                <span className="text-[10px] font-normal text-gray-400 ml-1">x / wk</span>
              </span>
            </div>
            <input
              type="range" min={1} max={7} step={1}
              value={fleet.plugInsPerWeek}
              onChange={e => updateFleet('plugInsPerWeek', Number(e.target.value))}
              className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131]
                [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer
                [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white" />
            <p className="text-[10px] text-gray-400 text-center">avg sessions per car</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

interface RangeBoundsProps {
  label: string
  min: number
  max: number
  minValue: number
  maxValue: number
  avgValue: number
  onChangeMin: (v: number) => void
  onChangeMax: (v: number) => void
  onChangeAvg: (v: number) => void
  format: (v: number) => string
}

function RangeWithBounds({ min, max, minValue, maxValue, avgValue, onChangeMin, onChangeMax, onChangeAvg, format }: RangeBoundsProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-400 w-8">min</span>
        <input
          type="range" min={min} max={max} step={1}
          value={minValue}
          onChange={e => onChangeMin(Number(e.target.value))}
          className="flex-1 h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gray-500
            [&::-webkit-slider-thumb]:cursor-pointer" />
        <span className="text-[10px] text-gray-500 w-12 text-right tabular-nums">{format(minValue)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-400 w-8">avg</span>
        <input
          type="range" min={min} max={max} step={1}
          value={avgValue}
          onChange={e => onChangeAvg(Number(e.target.value))}
          className="flex-1 h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131]
            [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer
            [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white" />
        <span className="text-[10px] text-gray-700 w-12 text-right tabular-nums font-semibold">{format(avgValue)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-400 w-8">max</span>
        <input
          type="range" min={min} max={max} step={1}
          value={maxValue}
          onChange={e => onChangeMax(Number(e.target.value))}
          className="flex-1 h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gray-500
            [&::-webkit-slider-thumb]:cursor-pointer" />
        <span className="text-[10px] text-gray-500 w-12 text-right tabular-nums">{format(maxValue)}</span>
      </div>
    </div>
  )
}

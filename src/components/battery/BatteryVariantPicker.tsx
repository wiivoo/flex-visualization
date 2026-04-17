'use client'

import { useCallback, useMemo } from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  BATTERY_VARIANTS,
  getDefaultLoadProfileId,
  getDefaultDischargeCapKw,
  getLoadProfilesForCountry,
  getVariant,
  type BatteryScenario,
  type BatteryVariant,
} from '@/lib/battery-config'
import { getTariffDefaults } from '@/lib/battery-economics'

interface Props {
  scenario: BatteryScenario
  setScenario: (s: BatteryScenario) => void
}

export function BatteryVariantPicker({ scenario, setScenario }: Props) {
  const activeVariant = useMemo(() => getVariant(scenario.variantId), [scenario.variantId])
  const loadProfiles = useMemo(() => getLoadProfilesForCountry(scenario.country), [scenario.country])

  const selectVariant = useCallback(
    (variant: BatteryVariant) => {
      setScenario({
        ...scenario,
        variantId: variant.id,
        feedInCapKw: getDefaultDischargeCapKw(variant),
      })
    },
    [scenario, setScenario],
  )

  const setCountry = useCallback(
    (country: 'DE' | 'NL') => {
      const defaults = getTariffDefaults(country)
      setScenario({
        ...scenario,
        country,
        tariffId: defaults.tariffId,
        loadProfileId: getDefaultLoadProfileId(country),
        feedInCapKw: Math.min(scenario.feedInCapKw, activeVariant.maxDischargeKw),
        terugleverCostEur: country === 'NL' ? scenario.terugleverCostEur : 0,
        exportCompensationPct: defaults.exportCompensationPct,
      })
    },
    [activeVariant.maxDischargeKw, scenario, setScenario],
  )

  const setAnnualLoad = useCallback(
    (raw: string) => {
      const n = Number(raw)
      if (!Number.isFinite(n)) return
      const clamped = Math.max(500, Math.min(15000, n))
      setScenario({ ...scenario, annualLoadKwh: clamped })
    },
    [scenario, setScenario],
  )

  const setDischargeCap = useCallback(
    (raw: string) => {
      if (activeVariant.lockedDischargeCapKw !== null) {
        setScenario({ ...scenario, feedInCapKw: activeVariant.lockedDischargeCapKw })
        return
      }
      const n = Number(raw)
      if (!Number.isFinite(n)) return
      const clamped = Math.max(0.8, Math.min(activeVariant.maxDischargeKw, n))
      setScenario({ ...scenario, feedInCapKw: Math.round(clamped * 10) / 10 })
    },
    [activeVariant, scenario, setScenario],
  )

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.9fr)]">
      <Card className="shadow-sm border-gray-200/80">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              Pick a real battery
            </p>
            <p className="text-[10px] text-gray-400">
              Dynamic day-ahead prices from the same market data used on `/dynamic`.
            </p>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {BATTERY_VARIANTS.map((variant) => {
              const isSelected = scenario.variantId === variant.id
              return (
                <button
                  key={variant.id}
                  type="button"
                  onClick={() => selectVariant(variant)}
                  aria-pressed={isSelected}
                  className={
                    'text-left rounded-2xl border p-4 transition-all focus:outline-none ' +
                    (isSelected
                      ? 'border-[#EA1C0A] ring-2 ring-[#EA1C0A]/20 bg-white'
                      : 'border-gray-200/80 bg-white hover:shadow-sm focus-visible:ring-2 focus-visible:ring-[#EA1C0A]')
                  }
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                        {variant.typeLabel}
                      </p>
                      <p className="text-[15px] font-semibold text-[#313131]">{variant.label}</p>
                    </div>
                    {variant.electricianRequired ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 shrink-0">
                        <AlertTriangle className="h-3 w-3" /> Electrician
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5 shrink-0">
                        Plug-in
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-gray-500 mb-3">{variant.description}</p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] tabular-nums">
                    <span className="text-gray-400">Usable</span>
                    <span className="font-semibold text-[#313131]">{variant.usableKwh} kWh</span>
                    <span className="text-gray-400">Output</span>
                    <span className="font-semibold text-[#313131]">{variant.maxDischargeKw} kW</span>
                    <span className="text-gray-400">Market price</span>
                    <span className="font-semibold text-[#313131]">{variant.currentPriceEur} EUR</span>
                    <span className="text-gray-400">Cap</span>
                    <span className="font-semibold text-[#313131]">
                      {variant.lockedDischargeCapKw !== null
                        ? `${variant.lockedDischargeCapKw} kW locked`
                        : `${scenario.feedInCapKw.toFixed(1)} kW adjustable`}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="text-[10px] text-gray-400">
                      {variant.merchantLabel} · {variant.priceAsOf}
                    </p>
                    <Link
                      href={variant.buyUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-[11px] font-semibold text-[#EA1C0A] hover:underline"
                    >
                      Buy / compare
                    </Link>
                  </div>
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm border-gray-200/80">
        <CardContent className="pt-4 pb-4 space-y-4">
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
              Country
            </p>
            <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5 w-fit">
              <button
                type="button"
                onClick={() => setCountry('DE')}
                className={
                  'text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ' +
                  (scenario.country === 'DE'
                    ? 'bg-white text-[#313131] shadow-sm'
                    : 'text-gray-400 hover:text-gray-600')
                }
              >
                DE
              </button>
              <button
                type="button"
                onClick={() => setCountry('NL')}
                className={
                  'text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ' +
                  (scenario.country === 'NL'
                    ? 'bg-white text-[#313131] shadow-sm'
                    : 'text-gray-400 hover:text-gray-600')
                }
              >
                NL
              </button>
              {scenario.country === 'NL' && (
                <span className="ml-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                  post-2027
                </span>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-gray-500">Annual consumption</span>
              <span className="text-sm font-bold tabular-nums text-[#313131]">{scenario.annualLoadKwh.toLocaleString()} kWh</span>
            </div>
            <input
              type="range"
              min={500}
              max={15000}
              step={100}
              value={scenario.annualLoadKwh}
              onChange={(e) => setAnnualLoad(e.target.value)}
              className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-[#EA1C0A] [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[#313131] [&::-moz-range-thumb]:border-0"
            />
            <Input
              id="battery-load-input"
              type="number"
              value={scenario.annualLoadKwh}
              min={500}
              max={15000}
              step={100}
              onChange={(e) => setAnnualLoad(e.target.value)}
              className="w-[140px] h-8 text-[12px] tabular-nums"
            />
          </div>

          <div className="space-y-2 pt-2 border-t border-gray-100">
            <p className="text-[10px] font-semibold text-gray-500">Household curve</p>
            <div className="flex flex-col gap-1.5">
              {loadProfiles.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => setScenario({ ...scenario, loadProfileId: profile.id })}
                  className={`text-left text-[11px] px-2.5 py-1.5 rounded-md border transition-colors ${
                    scenario.loadProfileId === profile.id
                      ? 'bg-gray-500 text-white border-gray-500'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <span className="font-semibold">{profile.label}</span>
                  <span className={`ml-1.5 ${scenario.loadProfileId === profile.id ? 'text-white/70' : 'text-gray-400'}`}>
                    {profile.description}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-400">
              The selected load shape drives both the daily chart and the annual ROI.
            </p>
          </div>

          <div className="space-y-2 pt-2 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-gray-500">Max discharge power</span>
              <span className="text-sm font-bold tabular-nums text-[#313131]">{scenario.feedInCapKw.toFixed(1)} kW</span>
            </div>
            <input
              type="range"
              min={0.8}
              max={activeVariant.maxDischargeKw}
              step={0.1}
              value={scenario.feedInCapKw}
              disabled={activeVariant.lockedDischargeCapKw !== null}
              onChange={(e) => setDischargeCap(e.target.value)}
              className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-[#EA1C0A] disabled:cursor-not-allowed disabled:opacity-60 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[#313131] [&::-moz-range-thumb]:border-0"
            />
            <p className="text-[10px] text-gray-400">
              {activeVariant.lockedDischargeCapKw !== null
                ? `Locked at ${activeVariant.lockedDischargeCapKw} kW for plug-in products.`
                : `Adjustable up to ${activeVariant.maxDischargeKw.toFixed(1)} kW for this battery.`}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

'use client'

import { useCallback, useMemo } from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
    <Card className="overflow-hidden shadow-sm border-gray-200/80">
      <CardHeader className="pb-2 bg-gray-50/80 border-b border-gray-100">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-[11px] font-semibold tracking-widest uppercase text-gray-400">
            Battery Profile
          </CardTitle>
          <span className="text-[10px] font-semibold text-[#EA1C0A]">
            Dynamic tariff
          </span>
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-5">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Battery</span>
            <span className="text-[10px] text-gray-400">Real products</span>
          </div>
          <div className="space-y-2">
            {BATTERY_VARIANTS.map((variant) => {
              const isSelected = scenario.variantId === variant.id
              return (
                <button
                  key={variant.id}
                  type="button"
                  onClick={() => selectVariant(variant)}
                  aria-pressed={isSelected}
                  className={
                    'w-full text-left rounded-2xl border p-3 transition-all focus:outline-none ' +
                    (isSelected
                      ? 'border-[#EA1C0A] ring-2 ring-[#EA1C0A]/20 bg-white'
                      : 'border-gray-200/80 bg-white hover:shadow-sm focus-visible:ring-2 focus-visible:ring-[#EA1C0A]')
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                        {variant.typeLabel}
                      </p>
                      <p className="text-[13px] font-semibold text-[#313131] leading-tight">
                        {variant.label}
                      </p>
                    </div>
                    {variant.electricianRequired ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 shrink-0">
                        <AlertTriangle className="h-3 w-3" /> Install
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5 shrink-0">
                        Plug-in
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-[11px] text-gray-500 leading-relaxed">
                    {variant.description}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] tabular-nums">
                    <span className="text-gray-400">Usable</span>
                    <span className="font-semibold text-[#313131]">{variant.usableKwh} kWh</span>
                    <span className="text-gray-400">Output</span>
                    <span className="font-semibold text-[#313131]">{variant.maxDischargeKw} kW</span>
                    <span className="text-gray-400">Market price</span>
                    <span className="font-semibold text-[#313131]">{variant.currentPriceEur} EUR</span>
                  </div>
                </button>
              )
            })}
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50/80 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-[#313131]">
                  {activeVariant.label}
                </p>
                <p className="text-[10px] text-gray-400">
                  {activeVariant.merchantLabel} · {activeVariant.priceAsOf}
                </p>
              </div>
              <Link
                href={activeVariant.buyUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] font-semibold text-[#EA1C0A] hover:underline shrink-0"
              >
                Buy / compare
              </Link>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-1 border-t border-gray-100">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Country</span>
            {scenario.country === 'NL' && (
              <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                post-2027
              </span>
            )}
          </div>
          <div className="flex items-center gap-0.5 bg-gray-100 rounded-full p-0.5 w-fit">
            <button
              type="button"
              onClick={() => setCountry('DE')}
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors ${
                scenario.country === 'DE'
                  ? 'bg-white text-[#313131] shadow-sm'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              Germany
            </button>
            <button
              type="button"
              onClick={() => setCountry('NL')}
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors ${
                scenario.country === 'NL'
                  ? 'bg-white text-[#313131] shadow-sm'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              Netherlands
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-1 border-t border-gray-100">
          <div className="flex items-baseline justify-between h-8">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Annual consumption</span>
            <span className="text-2xl font-bold text-[#313131] tabular-nums">
              {scenario.annualLoadKwh.toLocaleString()}
              <span className="text-xs font-normal text-gray-400 ml-1">kWh</span>
            </span>
          </div>
          <div>
            <input
              type="range"
              min={500}
              max={15000}
              step={100}
              value={scenario.annualLoadKwh}
              onChange={(e) => setAnnualLoad(e.target.value)}
              className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-[#EA1C0A] [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[#313131] [&::-moz-range-thumb]:border-0"
            />
            <div className="flex justify-between text-[10px] text-gray-400 mt-1">
              <span>500</span>
              <span>15,000</span>
            </div>
          </div>
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

        <div className="space-y-2 pt-1 border-t border-gray-100">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Household curve</span>
            <span className="text-[10px] text-gray-400">SLP based</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {loadProfiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                onClick={() => setScenario({ ...scenario, loadProfileId: profile.id })}
                className={`text-left rounded-xl border px-3 py-2 transition-colors ${
                  scenario.loadProfileId === profile.id
                    ? 'border-[#313131] bg-[#313131] text-white'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[11px] font-semibold">{profile.label}</span>
                  <span className={`text-[10px] ${scenario.loadProfileId === profile.id ? 'text-white/70' : 'text-gray-400'}`}>
                    {profile.description}
                  </span>
                </div>
                <p className={`mt-1 text-[10px] leading-relaxed ${scenario.loadProfileId === profile.id ? 'text-white/70' : 'text-gray-400'}`}>
                  {profile.detail}
                </p>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-1 border-t border-gray-100">
          <div className="flex items-baseline justify-between h-8">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Max discharge power</span>
            <span className="text-2xl font-bold text-[#313131] tabular-nums">
              {scenario.feedInCapKw.toFixed(1)}
              <span className="text-xs font-normal text-gray-400 ml-1">kW</span>
            </span>
          </div>
          <div>
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
            <div className="flex justify-between text-[10px] text-gray-400 mt-1">
              <span>0.8 kW</span>
              <span>{activeVariant.maxDischargeKw.toFixed(1)} kW</span>
            </div>
          </div>
          <p className="text-[10px] text-gray-400 leading-relaxed">
            {activeVariant.lockedDischargeCapKw !== null
              ? `Locked at ${activeVariant.lockedDischargeCapKw} kW because plug-in batteries can only support household load up to the plug-in limit.`
              : `Adjustable up to ${activeVariant.maxDischargeKw.toFixed(1)} kW for AC-coupled storage, so you can test how much peak household demand the battery can shave.`}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

'use client'

import { useCallback, useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { useBatteryProfiles } from '@/lib/use-battery-profiles'

interface Props {
  scenario: BatteryScenario
  setScenario: (s: BatteryScenario) => void
}

export function BatteryVariantPicker({ scenario, setScenario }: Props) {
  const [showBatteryDetails, setShowBatteryDetails] = useState(false)
  const activeVariant = useMemo(() => getVariant(scenario.variantId), [scenario.variantId])
  const loadProfiles = useMemo(() => getLoadProfilesForCountry(scenario.country), [scenario.country])
  const profileYear = new Date().getUTCFullYear()
  const profileData = useBatteryProfiles(scenario.country, scenario.loadProfileId, profileYear)

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

  const annualLoadPreview = useMemo(() => {
    if (!profileData.loadProfile) return null
    const days = Math.floor(profileData.loadProfile.length / 24)
    const dailyKwh: number[] = []
    for (let day = 0; day < days; day++) {
      const start = day * 24
      const dayShare = profileData.loadProfile
        .slice(start, start + 24)
        .reduce((sum, value) => sum + value, 0)
      dailyKwh.push(dayShare * scenario.annualLoadKwh)
    }
    const smoothed = dailyKwh.map((_, index) => {
      const from = Math.max(0, index - 7)
      const to = Math.min(dailyKwh.length - 1, index + 7)
      const window = dailyKwh.slice(from, to + 1)
      return window.reduce((sum, value) => sum + value, 0) / window.length
    })
    const min = Math.min(...smoothed)
    const max = Math.max(...smoothed)
    const width = 280
    const height = 76
    const path = smoothed.map((value, index) => {
      const x = (index / Math.max(1, smoothed.length - 1)) * width
      const y = max === min ? height / 2 : height - ((value - min) / (max - min)) * height
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    }).join(' ')
    const fillPath = `${path} L ${width},${height} L 0,${height} Z`
    return {
      width,
      height,
      path,
      fillPath,
      januaryKwh: smoothed[0] ?? 0,
      julyKwh: smoothed[Math.floor(smoothed.length / 2)] ?? 0,
      decemberKwh: smoothed[smoothed.length - 1] ?? 0,
    }
  }, [profileData.loadProfile, scenario.annualLoadKwh])

  return (
    <Card className="overflow-hidden shadow-sm border-gray-200/80 lg:max-h-[calc(100vh-6rem)] lg:flex lg:flex-col">
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

      <CardContent className="pt-4 space-y-5 lg:overflow-y-auto">
        <div className="flex flex-col gap-2">
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
        </div>

        <div className="space-y-2 pt-1 border-t border-gray-100">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Battery</span>
            <button
              type="button"
              onClick={() => setShowBatteryDetails((value) => !value)}
              className="text-[10px] font-semibold text-gray-400 hover:text-gray-600"
            >
              {showBatteryDetails ? 'Collapse details' : 'Expand details'}
            </button>
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
                    'w-full text-left rounded-2xl border px-3 py-2.5 transition-all focus:outline-none ' +
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
                      <p className="text-[12px] font-semibold text-[#313131] leading-tight">
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
                  <div className="mt-2 flex items-center gap-3 text-[10px] tabular-nums">
                    <span className="font-semibold text-[#313131]">{variant.usableKwh} kWh</span>
                    <span className="text-gray-300">•</span>
                    <span className="font-semibold text-[#313131]">{variant.maxDischargeKw} kW</span>
                    <span className="text-gray-300">•</span>
                    <span className="font-semibold text-[#313131]">{variant.currentPriceEur} EUR</span>
                  </div>
                  {showBatteryDetails && (
                    <div className="mt-2 space-y-2">
                      <p className="text-[11px] text-gray-500 leading-relaxed">
                        {variant.description}
                      </p>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] tabular-nums">
                        <span className="text-gray-400">Charge power</span>
                        <span className="font-semibold text-[#313131]">{variant.maxChargeKw} kW</span>
                        <span className="text-gray-400">Warranty</span>
                        <span className="font-semibold text-[#313131]">{variant.warrantyYears} years</span>
                        <span className="text-gray-400">Price source</span>
                        <span className="font-semibold text-[#313131]">{variant.priceAsOf}</span>
                      </div>
                    </div>
                  )}
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
                  {activeVariant.currentPriceEur} EUR · {activeVariant.priceAsOf}
                </p>
              </div>
              <span className="text-[10px] text-gray-400 shrink-0">{activeVariant.merchantLabel}</span>
            </div>
          </div>
        </div>

        <div className="space-y-2 pt-1 border-t border-gray-100">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Household curve</span>
            <span className="text-[10px] text-gray-400">SLP based</span>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50/80 px-3 py-3">
            {annualLoadPreview ? (
              <div className="space-y-2">
                <svg
                  viewBox={`0 0 ${annualLoadPreview.width} ${annualLoadPreview.height}`}
                  className="w-full h-[76px]"
                  aria-label="Annual household load profile preview"
                >
                  <path d={annualLoadPreview.fillPath} fill="rgba(234, 28, 10, 0.08)" />
                  <path d={annualLoadPreview.path} fill="none" stroke="#EA1C0A" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <div className="flex items-center justify-between text-[10px] text-gray-400">
                  <span>Jan {annualLoadPreview.januaryKwh.toFixed(1)} kWh/day</span>
                  <span>Jul {annualLoadPreview.julyKwh.toFixed(1)} kWh/day</span>
                  <span>Dec {annualLoadPreview.decemberKwh.toFixed(1)} kWh/day</span>
                </div>
                <p className="text-[10px] text-gray-500 leading-relaxed">
                  Yearly profile preview, smoothed over two weeks from the selected {scenario.country} standard load profile and scaled to {scenario.annualLoadKwh.toLocaleString()} kWh/year.
                </p>
              </div>
            ) : (
              <p className="text-[10px] text-gray-400">
                {profileData.loading ? 'Loading annual pattern…' : 'Annual profile preview unavailable.'}
              </p>
            )}
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
      </CardContent>
    </Card>
  )
}

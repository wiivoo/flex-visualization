'use client'

import { useCallback, useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  BATTERY_VARIANTS,
  getTariffsFor,
  type BatteryScenario,
  type BatteryVariant,
} from '@/lib/battery-config'

interface Props {
  scenario: BatteryScenario
  setScenario: (s: BatteryScenario) => void
}

export function BatteryVariantPicker({ scenario, setScenario }: Props) {
  const selectVariant = useCallback(
    (v: BatteryVariant) => {
      setScenario({ ...scenario, variantId: v.id })
    },
    [scenario, setScenario],
  )

  const setCountry = useCallback(
    (country: 'DE' | 'NL') => {
      // Reset tariff to the country's default so we never leave it pointing
      // at a DE tariff while NL is active (or vice versa).
      setScenario({
        ...scenario,
        country,
        tariffId: country === 'DE' ? 'awattar-de' : 'frank-energie',
      })
    },
    [scenario, setScenario],
  )

  const setTariff = useCallback(
    (tariffId: string) => {
      setScenario({ ...scenario, tariffId })
    },
    [scenario, setScenario],
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

  const tariffs = useMemo(() => getTariffsFor(scenario.country), [scenario.country])
  const showAssumptionFootnote = useMemo(
    () => BATTERY_VARIANTS.some(v => v.priceConfidence === 'LOW'),
    [],
  )

  return (
    <div className="space-y-4">
      {/* Row 1 — three variant cards */}
      <div className="flex flex-wrap gap-4">
        {BATTERY_VARIANTS.map(variant => {
          const isSelected = scenario.variantId === variant.id
          return (
            <button
              key={variant.id}
              type="button"
              onClick={() => selectVariant(variant)}
              aria-pressed={isSelected}
              className={
                'flex-1 min-w-[280px] text-left rounded-md transition-all focus:outline-none ' +
                (isSelected
                  ? 'ring-2 ring-[#EA1C0A] ring-offset-2 scale-[1.02]'
                  : 'border border-gray-200/80 shadow-sm hover:shadow-md focus-visible:ring-2 focus-visible:ring-[#EA1C0A]')
              }
            >
              <Card className="border-0 shadow-none">
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between mb-2">
                    <p className="text-base font-semibold text-[#313131]">{variant.label}</p>
                    {variant.electricianRequired ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                        <AlertTriangle className="h-3 w-3" /> Electrician req.
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5">
                        Plug-in
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-gray-500 mb-3">{variant.description}</p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] tabular-nums">
                    <span className="text-gray-400">Capacity</span>
                    <span className="font-semibold text-[#313131]">{variant.usableKwh} kWh</span>
                    <span className="text-gray-400">Max discharge</span>
                    <span className="font-semibold text-[#313131]">{variant.maxDischargeKw} kW</span>
                    <span className="text-gray-400">RTE</span>
                    <span className="font-semibold text-[#313131]">{Math.round(variant.roundTripEff * 100)}%</span>
                    <span className="text-gray-400">Warranty</span>
                    <span className="font-semibold text-[#313131]">{variant.warrantyYears} yr</span>
                    <span className="text-gray-400">Price (incl. VAT)</span>
                    <span
                      className={
                        'font-semibold tabular-nums ' +
                        (variant.priceConfidence === 'LOW' ? 'text-amber-600' : 'text-[#313131]')
                      }
                    >
                      {variant.hardwareCostEurIncVat} EUR
                      {variant.priceConfidence === 'LOW' ? ' *' : ''}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </button>
          )
        })}
      </div>

      {showAssumptionFootnote && (
        <ul className="space-y-0.5 -mt-2">
          <li className="text-[10px] text-gray-400">
            * Retail price not confirmed — placeholder based on similar model.
          </li>
        </ul>
      )}

      {/* Row 2 — country toggle + tariff + annual load */}
      <div className="flex flex-wrap items-end gap-4">
        {/* Country segmented control */}
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
            Country
          </p>
          <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5">
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
                post-2027 regime
              </span>
            )}
          </div>
        </div>

        {/* Tariff */}
        <div className="flex flex-col">
          <label
            className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1"
            htmlFor="battery-tariff-select"
          >
            Dynamic tariff
          </label>
          <Select value={scenario.tariffId} onValueChange={setTariff}>
            <SelectTrigger id="battery-tariff-select" className="w-[200px] h-8 text-[12px]">
              <SelectValue placeholder="Select tariff" />
            </SelectTrigger>
            <SelectContent>
              {tariffs.map(t => (
                <SelectItem key={t.id} value={t.id} className="text-[12px]">
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Annual load */}
        <div className="flex flex-col">
          <label
            className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1"
            htmlFor="battery-load-input"
          >
            Annual consumption (kWh)
          </label>
          <Input
            id="battery-load-input"
            type="number"
            value={scenario.annualLoadKwh}
            min={500}
            max={15000}
            step={100}
            onChange={e => setAnnualLoad(e.target.value)}
            className="w-[120px] h-8 text-[12px] tabular-nums"
          />
        </div>
      </div>
    </div>
  )
}

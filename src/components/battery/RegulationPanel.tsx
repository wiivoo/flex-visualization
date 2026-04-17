'use client'

/**
 * RegulationPanel — country-aware regulation controls for the plug-in battery
 * business case page (phase 08). Open-by-default collapsible card.
 *
 * DE controls (scenario.country === 'DE'):
 *   • Feed-in cap segmented control: 800W (current) / 2000W (proposed — amber badge)
 *   • Grid export: locked read-only "Prohibited" pill with VDE-AR-N 4105:2026-03 tooltip
 *   • §14a EnWG Module 3: locked read-only "Not applicable (< 4.2 kW)" chip
 *
 * NL controls (scenario.country === 'NL'):
 *   • Regime: locked read-only "post-2027" pill (salderingsregeling ends 2027-01-01)
 *   • Terugleverkosten segmented control: Dynamic (€0/yr) / Fixed (€150/yr)
 *   • Export compensation %: shadcn Input (range 50-115, default 50), clamped 0-200
 *   • 21% BTW assumption footnote (Belastingdienst source pending)
 *
 * The component only mutates `scenario` via `setScenario`; it does NOT invoke
 * the optimizer directly. Downstream components (BatteryDayChart, BatteryRoiCard)
 * pick up the new scenario on their next render.
 */

import { useCallback, useState } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Tooltip as ShadTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { BatteryScenario } from '@/lib/battery-config'

interface Props {
  scenario: BatteryScenario
  setScenario: (s: BatteryScenario) => void
}

export function RegulationPanel({ scenario, setScenario }: Props) {
  const [open, setOpen] = useState(true)    // open-by-default per UI-SPEC §Screen 5

  const setTerugleverkosten = useCallback(
    (eurYear: number) => {
      setScenario({ ...scenario, terugleverCostEur: eurYear })
    },
    [scenario, setScenario],
  )

  // Untrusted numeric input — clamp to the modeled post-2027 range [50, 115].
  const setExportCompensation = useCallback(
    (raw: string) => {
      const n = Number(raw)
      if (!Number.isFinite(n)) return
      const clamped = Math.max(50, Math.min(115, n))
      setScenario({ ...scenario, exportCompensationPct: clamped })
    },
    [scenario, setScenario],
  )

  return (
    <Card className="shadow-sm border-gray-200/80">
      <CardHeader className="pb-3 border-b border-gray-100">
        <button
          type="button"
          aria-label="Toggle regulation settings"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between"
        >
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
            Regulation settings — {scenario.country}
          </span>
          <span className="text-[10px] text-gray-400">{open ? '▲' : '▼'}</span>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="pt-4">
          {scenario.country === 'DE' ? (
            <DeControls scenario={scenario} />
          ) : (
            <NlControls
              scenario={scenario}
              setTerugleverkosten={setTerugleverkosten}
              setExportCompensation={setExportCompensation}
            />
          )}
        </CardContent>
      )}
    </Card>
  )
}

// ----------------------------------------------------------------------------
// DE controls
// ----------------------------------------------------------------------------

function DeControls({
  scenario,
}: {
  scenario: BatteryScenario
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Discharge cap summary */}
      <div>
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
          Discharge cap
        </p>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 border border-gray-200 text-[11px] text-[#313131] font-medium">
          {scenario.feedInCapKw.toFixed(1)} kW
        </span>
        <p className="text-[12px] text-gray-400 mt-1">
          Set in the left control bar. For plug-in products this stays locked at 0.8 kW.
        </p>
      </div>

      {/* Grid export — locked read-only pill with VDE-AR-N tooltip */}
      <div>
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
          Grid export
        </p>
        <TooltipProvider>
          <ShadTooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 border border-gray-200 text-[11px] text-gray-500 font-medium cursor-help">
                Prohibited
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[11px] max-w-[280px]">
              VDE-AR-N 4105:2026-03 — battery discharge to the grid is not permitted
              under the Steckerspeicher regime. Optimizer enforces self-consumption only.
            </TooltipContent>
          </ShadTooltip>
        </TooltipProvider>
        <p className="text-[12px] text-gray-400 mt-1">
          Locked by regulation — not user-configurable.
        </p>
      </div>

      {/* §14a EnWG Module 3 — locked read-only chip */}
      <div>
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
          §14a EnWG Module 3
        </p>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 border border-gray-200 text-[11px] text-gray-500 font-medium">
          Not applicable (&lt; 4.2 kW)
        </span>
        <p className="text-[12px] text-gray-400 mt-1">
          All modeled variants are below the controllable-load threshold.
        </p>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------
// NL controls
// ----------------------------------------------------------------------------

function NlControls({
  scenario,
  setTerugleverkosten,
  setExportCompensation,
}: {
  scenario: BatteryScenario
  setTerugleverkosten: (eurYear: number) => void
  setExportCompensation: (raw: string) => void
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Regime — locked post-2027 pill with salderingsregeling tooltip */}
      <div>
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
          Regime
        </p>
        <TooltipProvider>
          <ShadTooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[11px] font-medium cursor-help">
                post-2027
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[11px] max-w-[280px]">
              Salderingsregeling ends 2027-01-01. Current net-metering (1:1) is not modeled.
            </TooltipContent>
          </ShadTooltip>
        </TooltipProvider>
        <p className="text-[12px] text-gray-400 mt-1">
          Only post-2027 economics are modeled.
        </p>
      </div>

      {/* Terugleverkosten toggle — Dynamic €0/yr vs Fixed €150/yr */}
      <div>
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
          Terugleverkosten
        </p>
        <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5 w-fit">
          <button
            type="button"
            onClick={() => setTerugleverkosten(0)}
            className={
              'text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ' +
              (scenario.terugleverCostEur === 0
                ? 'bg-white text-[#313131] shadow-sm'
                : 'text-gray-400 hover:text-gray-600')
            }
          >
            Dynamic (€0/yr)
          </button>
          <button
            type="button"
            onClick={() => setTerugleverkosten(150)}
            className={
              'text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ' +
              (scenario.terugleverCostEur === 150
                ? 'bg-white text-[#313131] shadow-sm'
                : 'text-gray-400 hover:text-gray-600')
            }
          >
            Fixed (€150/yr)
          </button>
        </div>
        <p className="text-[12px] text-gray-400 mt-1">
          Supplier return-delivery fee structure.
        </p>
      </div>

      {/* Export compensation % — shadcn Input, clamped 50-115 in handler */}
      <div>
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
          Export compensation
        </p>
        <div className="flex items-center gap-1">
          <Input
            type="number"
            value={scenario.exportCompensationPct}
            min={50}
            max={115}
            step={5}
            onChange={(e) => setExportCompensation(e.target.value)}
            className="w-[80px] h-8 text-[12px] tabular-nums"
          />
          <span className="text-[12px] text-gray-500">% of market rate</span>
        </div>
        <p className="text-[12px] text-gray-400 mt-1">
          Minimum 50% floor through 2030. Frank Energie ≈ 115%.
        </p>
      </div>

      {/* BTW assumption footnote — only in NL context */}
      <div className="md:col-span-2">
        <p className="text-[10px] text-amber-600">
          * 21% BTW assumed for standalone battery (Belastingdienst source pending).
        </p>
      </div>
    </div>
  )
}

'use client'

import { useState, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import type { ChargingScenario, HourlyPrice, FleetConfig } from '@/lib/v2-config'
import type { EnrichedWindow } from '@/lib/excel-export'
import { generateEnhancedExcel } from '@/lib/excel-export'

type DateRange = 30 | 90 | 365
type Resolution = '60min' | '15min'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  scenario: ChargingScenario
  overnightWindows: EnrichedWindow[]
  hourlyPrices: HourlyPrice[]
  hourlyQH: HourlyPrice[]
  country: string
  currentResolution: 'hour' | 'quarterhour'
  showFleet: boolean
  fleetConfig: FleetConfig
}

export function ExportDialog({
  open,
  onOpenChange,
  scenario,
  overnightWindows,
  hourlyPrices,
  hourlyQH,
  country,
  currentResolution,
  showFleet,
  fleetConfig,
}: Props) {
  const [dateRange, setDateRange] = useState<DateRange>(365)
  const [resolution, setResolution] = useState<Resolution>(currentResolution === 'quarterhour' ? '15min' : '60min')
  const [sheets, setSheets] = useState({
    prices: true,
    profile: true,
    daily: true,
    monthly: true,
  })
  const [exporting, setExporting] = useState(false)

  const toggleSheet = useCallback((key: keyof typeof sheets) => {
    setSheets(prev => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const handleExport = useCallback(() => {
    setExporting(true)
    try {
      generateEnhancedExcel({
        scenario,
        overnightWindows,
        hourlyPrices,
        hourlyQH,
        country,
        dateRange,
        resolution,
        showFleet,
        fleetConfig,
        sheets,
      })
      onOpenChange(false)
    } finally {
      setExporting(false)
    }
  }, [scenario, overnightWindows, hourlyPrices, hourlyQH, country, dateRange, resolution, showFleet, fleetConfig, sheets, onOpenChange])

  const atLeastOneSheet = Object.values(sheets).some(Boolean)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px] bg-white">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">Export to Excel</DialogTitle>
          <DialogDescription className="text-[12px] text-gray-500">
            Configure your export and download an .xlsx file.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Date Range */}
          <div>
            <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Date Range</label>
            <div className="flex gap-1 mt-1.5">
              {([30, 90, 365] as const).map(d => (
                <button
                  key={d}
                  onClick={() => setDateRange(d)}
                  className={`px-3 py-1 text-[12px] font-medium rounded-md border transition-colors ${
                    dateRange === d
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {d === 365 ? '1 year' : `${d} days`}
                </button>
              ))}
            </div>
          </div>

          {/* Resolution */}
          <div>
            <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Resolution</label>
            <div className="flex gap-1 mt-1.5">
              {(['60min', '15min'] as const).map(r => (
                <button
                  key={r}
                  onClick={() => setResolution(r)}
                  className={`px-3 py-1 text-[12px] font-medium rounded-md border transition-colors ${
                    resolution === r
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {r === '60min' ? '60 min' : '15 min'}
                </button>
              ))}
            </div>
          </div>

          {/* Profile indicator */}
          <div>
            <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Profile</label>
            <div className="mt-1.5 text-[12px] font-medium text-gray-700 bg-gray-50 rounded-md px-3 py-1.5 border border-gray-100">
              {showFleet ? 'Fleet' : 'Single EV'} mode
            </div>
          </div>

          {/* Sheet selection */}
          <div>
            <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Sheets</label>
            <div className="mt-1.5 space-y-2">
              {([
                { key: 'prices' as const, label: 'Raw Prices', desc: 'Hourly/QH price data' },
                { key: 'profile' as const, label: 'Profile Settings', desc: 'Scenario parameters' },
                { key: 'daily' as const, label: 'Daily Sessions', desc: 'Per-session breakdown with formulas' },
                { key: 'monthly' as const, label: 'Monthly Summary', desc: 'Aggregated with SUMIF formulas' },
              ]).map(({ key, label, desc }) => (
                <label key={key} className="flex items-start gap-2 cursor-pointer group">
                  <Checkbox
                    checked={sheets[key]}
                    onCheckedChange={() => toggleSheet(key)}
                    className="mt-0.5"
                  />
                  <div>
                    <span className="text-[12px] font-medium text-gray-700 group-hover:text-gray-900">{label}</span>
                    <span className="text-[11px] text-gray-400 ml-1.5">{desc}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="mt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-[12px]"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleExport}
            disabled={!atLeastOneSheet || exporting}
            className="text-[12px] bg-gray-900 hover:bg-gray-800"
          >
            {exporting ? 'Exporting...' : 'Download .xlsx'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

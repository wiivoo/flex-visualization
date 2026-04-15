'use client'

import { Card, CardContent } from '@/components/ui/card'

export type TimeFrame =
  | { kind: 'last365' }
  | { kind: 'year'; year: number }
  | { kind: 'custom'; start: string; end: string }

interface Props {
  timeFrame: TimeFrame
  setTimeFrame: (t: TimeFrame) => void
  availableYears: number[]
  dataMin: string
  dataMax: string
}

export function TimeFrameBar({ timeFrame, setTimeFrame, availableYears, dataMin, dataMax }: Props) {
  const isLast365 = timeFrame.kind === 'last365'
  const isYear = timeFrame.kind === 'year'
  const isCustom = timeFrame.kind === 'custom'
  const customStart = isCustom ? timeFrame.start : dataMin
  const customEnd = isCustom ? timeFrame.end : dataMax

  return (
    <Card className="overflow-hidden shadow-sm border-gray-200/80">
      <CardContent className="py-3 px-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mr-1">
            Time frame
          </span>

          {/* Last 365 days */}
          <button
            onClick={() => setTimeFrame({ kind: 'last365' })}
            className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-colors ${
              isLast365 ? 'bg-[#313131] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            Last 365 days
          </button>

          {/* Full-year buttons */}
          {availableYears.map(y => (
            <button
              key={y}
              onClick={() => setTimeFrame({ kind: 'year', year: y })}
              className={`px-3 py-1 rounded-md text-[11px] font-semibold tabular-nums transition-colors ${
                isYear && timeFrame.year === y
                  ? 'bg-[#313131] text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {y}
            </button>
          ))}

          <div className="h-5 w-px bg-gray-200" aria-hidden />

          {/* Custom range */}
          <button
            onClick={() =>
              setTimeFrame({ kind: 'custom', start: customStart, end: customEnd })
            }
            className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-colors ${
              isCustom ? 'bg-[#313131] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            Custom
          </button>

          {isCustom && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                min={dataMin}
                max={dataMax}
                value={customStart}
                onChange={e =>
                  setTimeFrame({ kind: 'custom', start: e.target.value, end: customEnd })
                }
                className="text-[11px] tabular-nums border border-gray-200 rounded-md px-2 py-1 bg-white text-gray-700"
              />
              <span className="text-[11px] text-gray-400">→</span>
              <input
                type="date"
                min={dataMin}
                max={dataMax}
                value={customEnd}
                onChange={e =>
                  setTimeFrame({ kind: 'custom', start: customStart, end: e.target.value })
                }
                className="text-[11px] tabular-nums border border-gray-200 rounded-md px-2 py-1 bg-white text-gray-700"
              />
            </div>
          )}

          <span className="ml-auto text-[10px] text-gray-400">
            Data available: {dataMin} → {dataMax}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

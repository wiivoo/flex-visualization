'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AnimatedNumber } from '@/components/v2/AnimatedNumber'

interface Props {
  savingsPerSession: number
  baseEnergyKwh: number
  currentMileage: number
  currentFrequency: number
  onNext: () => void
  onBack: () => void
}

const SESSIONS_PER_WEEK = [2, 3, 4, 5, 6, 7]
const YEARLY_MILEAGE = [5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000]

function getGreenClass(value: number, maxValue: number): string {
  const ratio = maxValue > 0 ? value / maxValue : 0
  if (ratio < 0.15) return 'bg-green-50 text-green-900'
  if (ratio < 0.3) return 'bg-green-100 text-green-900'
  if (ratio < 0.45) return 'bg-green-200 text-green-900'
  if (ratio < 0.6) return 'bg-green-300 text-green-900'
  if (ratio < 0.75) return 'bg-green-400 text-white'
  if (ratio < 0.9) return 'bg-green-500 text-white'
  return 'bg-green-600 text-white'
}

export function Step3CustomerBehavior({
  savingsPerSession,
  baseEnergyKwh,
  currentMileage,
  currentFrequency,
  onNext,
  onBack,
}: Props) {
  const heatmapData = useMemo(() => {
    const cells: { mileage: number; sessions: number; savings: number }[] = []
    let maxSavings = 0

    for (const mileage of YEARLY_MILEAGE) {
      for (const sessions of SESSIONS_PER_WEEK) {
        const annualSessions = sessions * 52
        const kmPerSession = mileage / annualSessions
        const energyPerSession = (kmPerSession / 100) * 18
        const scaleFactor = baseEnergyKwh > 0 ? energyPerSession / baseEnergyKwh : 1
        const annualSavings = Math.round(savingsPerSession * scaleFactor * annualSessions)
        cells.push({ mileage, sessions, savings: annualSavings })
        if (annualSavings > maxSavings) maxSavings = annualSavings
      }
    }

    return { cells, maxSavings }
  }, [savingsPerSession, baseEnergyKwh])

  // Find closest mileage/frequency if exact match not in grid
  const closestMileage = YEARLY_MILEAGE.reduce((prev, curr) =>
    Math.abs(curr - currentMileage) < Math.abs(prev - currentMileage) ? curr : prev
  )
  const closestFrequency = SESSIONS_PER_WEEK.reduce((prev, curr) =>
    Math.abs(curr - currentFrequency) < Math.abs(prev - currentFrequency) ? curr : prev
  )

  const currentSavings = useMemo(() => {
    const cell = heatmapData.cells.find(
      c => c.mileage === closestMileage && c.sessions === closestFrequency
    )
    return cell?.savings ?? 0
  }, [heatmapData, closestMileage, closestFrequency])

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="text-center mb-6">
        <h2 className="text-4xl font-bold text-[#313131] mb-2">
          What behavior creates what value?
        </h2>
        <p className="text-lg text-gray-500 max-w-3xl mx-auto">
          Not every customer saves the same. More mileage and more frequent charging sessions
          mean more optimization potential — and more annual savings.
        </p>
      </div>

      {/* Current Profile KPI */}
      <Card className="border-[#EA1C0A]/20">
        <CardContent className="pt-4 pb-3 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Your Profile Annual Savings</p>
          <AnimatedNumber
            value={currentSavings}
            prefix="~"
            suffix=" EUR/year"
            className="text-3xl font-bold text-[#EA1C0A]"
          />
          <p className="text-sm text-gray-500 mt-1">
            {currentMileage.toLocaleString('en-US')} km/year, {currentFrequency}x charging per week
          </p>
        </CardContent>
      </Card>

      {/* Heatmap */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Annual Savings by Driving Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              {/* Header row: sessions per week */}
              <div className="flex items-center gap-1 mb-1">
                <div className="w-20 shrink-0 text-right pr-2 text-xs text-gray-400">
                  km/year
                </div>
                {SESSIONS_PER_WEEK.map(s => (
                  <div
                    key={s}
                    className="flex-1 text-center text-xs font-medium text-gray-500"
                  >
                    {s}x/wk
                  </div>
                ))}
              </div>

              {/* Data rows */}
              {YEARLY_MILEAGE.map(mileage => (
                <div key={mileage} className="flex items-center gap-1 mb-1">
                  <div className="w-20 shrink-0 text-right pr-2 text-xs text-gray-500 font-medium">
                    {(mileage / 1000).toFixed(0)}k
                  </div>
                  {SESSIONS_PER_WEEK.map(sessions => {
                    const cell = heatmapData.cells.find(
                      c => c.mileage === mileage && c.sessions === sessions
                    )
                    const savings = cell?.savings ?? 0
                    const isCurrentProfile =
                      mileage === closestMileage && sessions === closestFrequency
                    const colorClass = getGreenClass(savings, heatmapData.maxSavings)

                    return (
                      <div
                        key={sessions}
                        className={`flex-1 h-10 rounded-md flex items-center justify-center text-xs font-semibold transition-all ${colorClass} ${
                          isCurrentProfile
                            ? 'ring-2 ring-[#EA1C0A] ring-offset-1 shadow-md'
                            : ''
                        }`}
                        title={`${mileage.toLocaleString('en-US')} km/yr, ${sessions}x/wk: ~${savings} EUR/year`}
                        aria-label={`${mileage} km per year, ${sessions} sessions per week: approximately ${savings} EUR annual savings`}
                      >
                        {savings}
                      </div>
                    )
                  })}
                </div>
              ))}

              {/* Axis label */}
              <div className="flex items-center gap-1 mt-2">
                <div className="w-20 shrink-0" />
                <div className="flex-1 text-center text-xs text-gray-400">
                  Charging sessions per week &rarr;
                </div>
              </div>

              {/* Legend */}
              <div className="flex items-center gap-2 mt-3 text-[10px] text-gray-500 ml-20">
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 bg-green-100 rounded-sm border border-green-200" />
                  Low
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 bg-green-300 rounded-sm" />
                  Medium
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 bg-green-600 rounded-sm" />
                  High
                </span>
                <span className="ml-2 flex items-center gap-1">
                  <span className="w-3 h-3 rounded-sm ring-2 ring-[#EA1C0A] ring-offset-1" />
                  Your profile
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Insight Card */}
      <Card className="bg-green-50 border-green-200">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
              i
            </div>
            <div>
              <p className="font-semibold text-[#313131] mb-1">Key Insight</p>
              <p className="text-sm text-gray-700 leading-relaxed">
                Higher mileage combined with more frequent charging sessions creates the most value.
                A customer driving 30,000 km/year who plugs in daily generates significantly more
                optimization potential than a 10,000 km/year driver charging twice a week. The sweet
                spot for most customers is 15,000-25,000 km with 4-5 sessions per week.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between items-center pt-4">
        <Button variant="outline" onClick={onBack}>
          &larr; Back: Smart Charging
        </Button>
        <p className="text-gray-500 text-sm">How do all 5 value layers add up?</p>
        <Button
          onClick={onNext}
          size="lg"
          className="bg-[#EA1C0A] hover:bg-[#C51608] text-white px-8"
        >
          Next: Value Waterfall &rarr;
        </Button>
      </div>
    </div>
  )
}

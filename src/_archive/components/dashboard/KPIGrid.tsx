'use client'

import { PiggyBank, TrendingUp, Gift, Clock } from 'lucide-react'
import { KPICard, KPICardSkeleton } from './KPICard'
import type { OptimizationResult } from '@/lib/config'

interface KPIGridProps {
  optimization: OptimizationResult | null
  isLoading?: boolean
}

/**
 * Format a EUR amount: "€ 18.40"
 * Uses explicit € prefix (no Intl) for maximum control over presentation.
 */
function formatEUR(amount: number): string {
  const abs = Math.abs(amount)
  const formatted = abs
    .toFixed(2)
    .replace('.', ',')
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')

  return amount < 0 ? `- € ${formatted}` : `€ ${formatted}`
}

/**
 * Derive best charging time from the charging schedule.
 * Returns the earliest start and latest end in "HH:MM - HH:MM" format.
 */
function getBestChargingTime(opt: OptimizationResult): string {
  const schedule = opt.charging_schedule
  if (!schedule || schedule.length === 0) return '-'

  const starts = schedule.map((b) => b.start)
  const ends = schedule.map((b) => b.end)

  const earliest = starts.sort()[0]
  const latest = ends.sort().reverse()[0]

  const fmtTime = (iso: string) => {
    try {
      const d = new Date(iso)
      return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    } catch {
      return iso.slice(11, 16)
    }
  }

  return `${fmtTime(earliest)} - ${fmtTime(latest)}`
}

const SKELETON_THEMES = ['green', 'blue', 'purple', 'amber'] as const

export function KPIGrid({ optimization, isLoading }: KPIGridProps) {
  // --- Loading state: animated skeletons ---
  if (isLoading) {
    return (
      <div
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Loading KPIs"
        role="status"
      >
        {SKELETON_THEMES.map((theme) => (
          <KPICardSkeleton key={theme} colorTheme={theme} />
        ))}
      </div>
    )
  }

  // --- Empty / null state: placeholder cards ---
  if (!optimization) {
    return (
      <div
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="KPI Metrics"
      >
        <KPICard
          title="Savings per Charge"
          value="-"
          icon={PiggyBank}
          description="No data"
          colorTheme="green"
        />
        <KPICard
          title="Our Margin per Month"
          value="-"
          icon={TrendingUp}
          description="No data"
          colorTheme="blue"
        />
        <KPICard
          title="Customer Benefit"
          value="-"
          icon={Gift}
          description="No data"
          colorTheme="purple"
        />
        <KPICard
          title="Best Charging Time"
          value="-"
          icon={Clock}
          description="No data"
          colorTheme="amber"
        />
      </div>
    )
  }

  // --- Populated state ---
  const monthlyMargin = optimization.our_margin_eur * 30

  return (
    <div
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      aria-label="KPI Metrics"
    >
      {/* KPI 1: Savings per Charge */}
      <KPICard
        title="Savings per Charge"
        value={formatEUR(optimization.savings_eur)}
        icon={PiggyBank}
        trend="up"
        description="Through flexible charge control"
        colorTheme="green"
      />

      {/* KPI 2: Our Margin per Month */}
      <KPICard
        title="Our Margin per Month"
        value={formatEUR(monthlyMargin)}
        unit="/ car"
        icon={TrendingUp}
        trend="up"
        description={`${formatEUR(optimization.our_margin_eur)} per charge x 30`}
        colorTheme="blue"
      />

      {/* KPI 3: Customer Benefit */}
      <KPICard
        title="Customer Benefit"
        value={formatEUR(optimization.customer_benefit_eur)}
        unit="/ charge"
        icon={Gift}
        trend="up"
        description="Savings for the end customer"
        colorTheme="purple"
      />

      {/* KPI 4: Best Charging Time */}
      <KPICard
        title="Best Charging Time"
        value={getBestChargingTime(optimization)}
        icon={Clock}
        description="Cheapest hours based on market price"
        colorTheme="amber"
      />
    </div>
  )
}

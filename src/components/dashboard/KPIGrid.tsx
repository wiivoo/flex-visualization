'use client'

import { PiggyBank, TrendingUp, Gift, Clock } from 'lucide-react'
import { KPICard, MoneyKPICard, KPICardSkeleton } from './KPICard'
import type { OptimizationResult } from '@/lib/config'

interface KPIGridProps {
  optimization: OptimizationResult | null
  isLoading?: boolean
}

/**
 * Format a EUR amount the German way: "€ 18,40"
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
 * Derive "Beste Ladezeit" from the charging schedule.
 * Returns the earliest start and latest end in "HH:MM - HH:MM Uhr" format.
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
      return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    } catch {
      return iso.slice(11, 16)
    }
  }

  return `${fmtTime(earliest)} - ${fmtTime(latest)} Uhr`
}

const SKELETON_THEMES = ['green', 'blue', 'purple', 'amber'] as const

export function KPIGrid({ optimization, isLoading }: KPIGridProps) {
  // --- Loading state: animated skeletons ---
  if (isLoading) {
    return (
      <div
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="KPIs werden geladen"
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
        aria-label="KPI-Kennzahlen"
      >
        <KPICard
          title="Ersparnis pro Ladung"
          value="-"
          icon={PiggyBank}
          description="Keine Daten"
          colorTheme="green"
        />
        <KPICard
          title="Unsere Marge pro Monat"
          value="-"
          icon={TrendingUp}
          description="Keine Daten"
          colorTheme="blue"
        />
        <KPICard
          title="Kunden-Vorteil"
          value="-"
          icon={Gift}
          description="Keine Daten"
          colorTheme="purple"
        />
        <KPICard
          title="Beste Ladezeit"
          value="-"
          icon={Clock}
          description="Keine Daten"
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
      aria-label="KPI-Kennzahlen"
    >
      {/* KPI 1: Ersparnis pro Ladung */}
      <KPICard
        title="Ersparnis pro Ladung"
        value={formatEUR(optimization.savings_eur)}
        icon={PiggyBank}
        trend="up"
        description="Durch flexible Ladesteuerung"
        colorTheme="green"
      />

      {/* KPI 2: Unsere Marge pro Monat */}
      <KPICard
        title="Unsere Marge pro Monat"
        value={formatEUR(monthlyMargin)}
        unit="/ Auto"
        icon={TrendingUp}
        trend="up"
        description={`${formatEUR(optimization.our_margin_eur)} pro Ladung x 30`}
        colorTheme="blue"
      />

      {/* KPI 3: Kunden-Vorteil */}
      <KPICard
        title="Kunden-Vorteil"
        value={formatEUR(optimization.customer_benefit_eur)}
        unit="/ Ladung"
        icon={Gift}
        trend="up"
        description="Ersparnis fuer den Endkunden"
        colorTheme="purple"
      />

      {/* KPI 4: Beste Ladezeit */}
      <KPICard
        title="Beste Ladezeit"
        value={getBestChargingTime(optimization)}
        icon={Clock}
        description="Guenstigste Stunden laut Marktpreis"
        colorTheme="amber"
      />
    </div>
  )
}

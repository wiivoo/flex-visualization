'use client'

import { Wallet, PiggyBank, TrendingUp, Zap } from 'lucide-react'
import { KPICard, MoneyKPICard } from './KPICard'
import { OptimizationResult } from '@/lib/config'

interface KPIGridProps {
  optimization: OptimizationResult | null
  isLoading?: boolean
}

export function KPIGrid({ optimization, isLoading }: KPIGridProps) {
  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    )
  }

  if (!optimization) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPICard title="Kosten ohne Flex" value="-" unit="EUR" />
        <KPICard title="Kosten mit Flex" value="-" unit="EUR" />
        <KPICard title="Ersparnis" value="-" unit="EUR" />
        <KPICard title="Win-Win" value="-" unit="EUR" />
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <MoneyKPICard
        title="Kosten ohne Flex"
        amount={optimization.cost_without_flex_eur}
        icon={Wallet}
        positiveIsGood={false}
        description="Bei Standardpreis"
      />

      <MoneyKPICard
        title="Kosten mit Flex"
        amount={optimization.cost_with_flex_eur}
        icon={Zap}
        positiveIsGood={false}
        description="Optimiertes Laden"
      />

      <MoneyKPICard
        title="Ersparnis"
        amount={optimization.savings_eur}
        icon={PiggyBank}
        positiveIsGood={true}
        description="Durch Flexibilität"
      />

      <MoneyKPICard
        title="Win-Win"
        amount={optimization.win_win_eur}
        icon={TrendingUp}
        positiveIsGood={true}
        description="Gesamtvorteil"
      />
    </div>
  )
}

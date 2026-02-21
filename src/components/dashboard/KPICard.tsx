import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LucideIcon, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface KPICardProps {
  title: string
  value: string | number
  unit?: string
  icon?: LucideIcon
  trend?: 'up' | 'down' | 'neutral'
  description?: string
  className?: string
}

export function KPICard({
  title,
  value,
  unit,
  icon: Icon,
  trend,
  description,
  className
}: KPICardProps) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus
  const trendColor = trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-600' : 'text-muted-foreground'

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold">{value}</span>
          {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
        </div>
        {description && (
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            {trend && <TrendIcon className={cn('h-3 w-3', trendColor)} />}
            {description}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

interface MoneyKPICardProps {
  title: string
  amount: number
  icon?: LucideIcon
  positiveIsGood?: boolean
  description?: string
}

export function MoneyKPICard({
  title,
  amount,
  icon: Icon,
  positiveIsGood = true,
  description
}: MoneyKPICardProps) {
  const formattedAmount = new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Math.abs(amount))

  const isNegative = amount < 0
  const trend = amount > 0 ? (positiveIsGood ? 'up' : 'down') : isNegative ? (positiveIsGood ? 'down' : 'up') : 'neutral'
  const valueStr = isNegative ? `-${formattedAmount}` : formattedAmount

  return (
    <KPICard
      title={title}
      value={valueStr}
      icon={Icon}
      trend={trend}
      description={description}
    />
  )
}

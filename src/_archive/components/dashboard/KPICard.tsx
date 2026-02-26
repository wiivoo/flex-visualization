import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { LucideIcon, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

// ---------- color theme config ----------
export type KPIColorTheme = 'green' | 'blue' | 'purple' | 'amber'

const themeClasses: Record<KPIColorTheme, { bg: string; icon: string; ring: string }> = {
  green: {
    bg: 'bg-green-50 dark:bg-green-950/30',
    icon: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400',
    ring: 'ring-green-200/60 dark:ring-green-800/40',
  },
  blue: {
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    icon: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400',
    ring: 'ring-blue-200/60 dark:ring-blue-800/40',
  },
  purple: {
    bg: 'bg-purple-50 dark:bg-purple-950/30',
    icon: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-400',
    ring: 'ring-purple-200/60 dark:ring-purple-800/40',
  },
  amber: {
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    icon: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400',
    ring: 'ring-amber-200/60 dark:ring-amber-800/40',
  },
}

// ---------- generic KPICard ----------
interface KPICardProps {
  title: string
  value: string | number
  unit?: string
  icon?: LucideIcon
  trend?: 'up' | 'down' | 'neutral'
  description?: string
  colorTheme?: KPIColorTheme
  className?: string
}

export function KPICard({
  title,
  value,
  unit,
  icon: Icon,
  trend,
  description,
  colorTheme,
  className,
}: KPICardProps) {
  const TrendIcon =
    trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus
  const trendColor =
    trend === 'up'
      ? 'text-green-600'
      : trend === 'down'
        ? 'text-red-600'
        : 'text-muted-foreground'

  const theme = colorTheme ? themeClasses[colorTheme] : null

  return (
    <Card
      className={cn(
        'overflow-hidden ring-1 ring-border/50 transition-shadow hover:shadow-md',
        theme?.bg,
        theme?.ring,
        className,
      )}
    >
      <CardContent className="flex items-start gap-4 p-5">
        {/* Icon bubble */}
        {Icon && (
          <div
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
              theme?.icon ?? 'bg-muted text-muted-foreground',
            )}
            aria-hidden="true"
          >
            <Icon className="h-5 w-5" />
          </div>
        )}

        {/* Text content */}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>

          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-3xl font-bold tracking-tight lg:text-4xl">
              {value}
            </span>
            {unit && (
              <span className="text-sm font-medium text-muted-foreground">
                {unit}
              </span>
            )}
          </div>

          {description && (
            <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
              {trend && trend !== 'neutral' && (
                <TrendIcon className={cn('h-3 w-3', trendColor)} />
              )}
              {description}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------- skeleton loading card ----------
export function KPICardSkeleton({ colorTheme }: { colorTheme?: KPIColorTheme }) {
  const theme = colorTheme ? themeClasses[colorTheme] : null

  return (
    <Card
      className={cn(
        'overflow-hidden ring-1 ring-border/50',
        theme?.bg,
        theme?.ring,
      )}
    >
      <CardContent className="flex items-start gap-4 p-5">
        <Skeleton className="h-11 w-11 shrink-0 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      </CardContent>
    </Card>
  )
}

// ---------- MoneyKPICard (kept for backwards compat) ----------
interface MoneyKPICardProps {
  title: string
  amount: number
  icon?: LucideIcon
  positiveIsGood?: boolean
  description?: string
  colorTheme?: KPIColorTheme
}

export function MoneyKPICard({
  title,
  amount,
  icon: Icon,
  positiveIsGood = true,
  description,
  colorTheme,
}: MoneyKPICardProps) {
  const formattedAmount = new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount))

  const isNegative = amount < 0
  const trend =
    amount > 0
      ? positiveIsGood
        ? 'up'
        : 'down'
      : isNegative
        ? positiveIsGood
          ? 'down'
          : 'up'
        : ('neutral' as const)
  const valueStr = isNegative ? `-${formattedAmount}` : formattedAmount

  return (
    <KPICard
      title={title}
      value={valueStr}
      icon={Icon}
      trend={trend}
      description={description}
      colorTheme={colorTheme}
    />
  )
}

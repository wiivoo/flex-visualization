'use client'

import { DollarSign } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { type ConfigState } from '@/lib/config'
import { cn } from '@/lib/utils'

interface PriceInputsProps {
  config: Pick<ConfigState, 'base_price_ct_kwh' | 'margin_ct_kwh' | 'customer_discount_ct_kwh'>
  onChange: (key: keyof ConfigState, value: number) => void
  errors?: string[]
}

export function PriceInputs({ config, onChange, errors }: PriceInputsProps) {
  const hasError = errors && errors.length > 0

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <DollarSign className="h-4 w-4" />
          Prices (ct/kWh)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="base-price">Base Price</Label>
            <Input
              id="base-price"
              type="number"
              min={10}
              max={100}
              value={config.base_price_ct_kwh}
              onChange={(e) => onChange('base_price_ct_kwh', parseFloat(e.target.value) || 0)}
              className={cn(
                config.base_price_ct_kwh < 10 || config.base_price_ct_kwh > 100 ? 'border-red-500' : ''
              )}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="margin">Margin</Label>
            <Input
              id="margin"
              type="number"
              min={0}
              max={20}
              value={config.margin_ct_kwh}
              onChange={(e) => onChange('margin_ct_kwh', parseFloat(e.target.value) || 0)}
              className={cn(config.margin_ct_kwh > config.base_price_ct_kwh ? 'border-amber-500' : '')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="discount">Discount</Label>
            <Input
              id="discount"
              type="number"
              min={0}
              max={50}
              value={config.customer_discount_ct_kwh}
              onChange={(e) => onChange('customer_discount_ct_kwh', parseFloat(e.target.value) || 0)}
            />
          </div>
        </div>

        {config.margin_ct_kwh > config.base_price_ct_kwh && (
          <p className="text-xs text-amber-600">
            Warning: Margin exceeds base price
          </p>
        )}

        {hasError && (
          <div className="rounded-md bg-red-50 p-2 text-xs text-red-800 dark:bg-red-900/20 dark:text-red-400">
            {errors.join(', ')}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

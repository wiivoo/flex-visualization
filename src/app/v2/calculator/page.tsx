import { Suspense } from 'react'

import { FlexValueCalculator } from '@/components/v2/calculator/FlexValueCalculator'
import { getEnableGb, getEnableIntraday } from '@/lib/country-config'

export const dynamic = 'force-dynamic'

export default function V2CalculatorPage() {
  return (
    <Suspense>
      <FlexValueCalculator enableGb={getEnableGb()} enableIntraday={getEnableIntraday()} />
    </Suspense>
  )
}

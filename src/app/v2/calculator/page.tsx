'use client'

import { Suspense } from 'react'

import { FlexValueCalculator } from '@/components/v2/calculator/FlexValueCalculator'

export default function V2CalculatorPage() {
  return (
    <Suspense>
      <FlexValueCalculator />
    </Suspense>
  )
}

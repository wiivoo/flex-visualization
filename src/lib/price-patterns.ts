/**
 * Aggregate quarter-hour price data into a (month × quarter-hour-of-day) matrix.
 * Used by PricePatternsHeatmap on /v2/insights.
 */
import type { HourlyPrice } from '@/lib/v2-config'

export interface MonthlyQhMatrix {
  /** 12 × 96 grid of avg ct/kWh. cells[month 0..11][qhOfDay 0..95]. NaN when no samples. */
  cells: number[][]
  /** Global min ct/kWh across all non-NaN cells. */
  min: number
  /** Global max ct/kWh across all non-NaN cells. */
  max: number
  /** 5th percentile of non-NaN cells (for color clamp). */
  p5: number
  /** 95th percentile of non-NaN cells (for color clamp). */
  p95: number
  /** Total raw QH points aggregated. */
  sampleCount: number
}

/**
 * Group QH prices by (month 1-12, qh-of-day 0-95), average priceEurMwh, convert to ct/kWh (÷10).
 * Skips projected points so the pattern reflects realized prices.
 */
export function computeMonthlyQhAverages(hourlyQH: HourlyPrice[]): MonthlyQhMatrix {
  const sums: number[][] = Array.from({ length: 12 }, () => new Array(96).fill(0))
  const counts: number[][] = Array.from({ length: 12 }, () => new Array(96).fill(0))
  let sampleCount = 0

  for (const p of hourlyQH) {
    if (p.isProjected) continue
    const monthIdx = Number(p.date.slice(5, 7)) - 1
    if (monthIdx < 0 || monthIdx > 11) continue
    const qh = p.hour * 4 + Math.floor((p.minute ?? 0) / 15)
    if (qh < 0 || qh > 95) continue
    sums[monthIdx][qh] += p.priceEurMwh
    counts[monthIdx][qh] += 1
    sampleCount++
  }

  const cells: number[][] = Array.from({ length: 12 }, () => new Array(96).fill(NaN))
  const flat: number[] = []
  let min = Infinity
  let max = -Infinity
  for (let m = 0; m < 12; m++) {
    for (let q = 0; q < 96; q++) {
      const c = counts[m][q]
      if (c > 0) {
        const ctKwh = sums[m][q] / c / 10
        cells[m][q] = ctKwh
        flat.push(ctKwh)
        if (ctKwh < min) min = ctKwh
        if (ctKwh > max) max = ctKwh
      }
    }
  }

  if (flat.length === 0) {
    return { cells, min: 0, max: 0, p5: 0, p95: 0, sampleCount: 0 }
  }

  const sorted = [...flat].sort((a, b) => a - b)
  const pct = (q: number) => {
    const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1))))
    return sorted[idx]
  }
  return {
    cells,
    min: Math.round(min * 10) / 10,
    max: Math.round(max * 10) / 10,
    p5: Math.round(pct(0.05) * 10) / 10,
    p95: Math.round(pct(0.95) * 10) / 10,
    sampleCount,
  }
}

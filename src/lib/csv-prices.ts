/**
 * CSV Price Parser
 * Fallback data source for day-ahead and intraday prices
 *
 * CSV Format: timestamp,price (€/MWh)
 * Location: /CSVs/
 */

import { parseISO, format, startOfDay, differenceInHours } from 'date-fns'

export interface CsvPricePoint {
  timestamp: string
  price_ct_kwh: number
}

/**
 * Get the correct CSV filename for a date and type
 */
function getCsvFilename(date: Date, type: 'day-ahead' | 'intraday'): string {
  const year = date.getFullYear()
  const prefix = type === 'day-ahead' ? 'spot_price' : 'intraday_price'
  return `${prefix}_${year}.csv`
}

/**
 * Get the absolute path to the CSV file
 */
function getCsvPath(filename: string): string {
  // CSVs are in the project root at /CSVs/
  return `${process.cwd()}/CSVs/${filename}`
}

/**
 * Read and parse a CSV file for a specific date
 */
export async function fetchCsvPrices(
  type: 'day-ahead' | 'intraday',
  date: Date
): Promise<CsvPricePoint[]> {
  const filename = getCsvFilename(date, type)
  const csvPath = getCsvPath(filename)

  try {
    const fs = await import('fs/promises')
    const csvContent = await fs.readFile(csvPath, 'utf-8')

    // Parse CSV
    const lines = csvContent.trim().split('\n')
    const header = lines[0].split(',')

    // Find column indices
    const timestampIndex = header.findIndex(h =>
      h.toLowerCase().includes('timestamp')
    )
    const priceIndex = header.findIndex(h =>
      h.toLowerCase().includes('price')
    )

    if (timestampIndex === -1 || priceIndex === -1) {
      throw new Error('CSV format invalid: missing timestamp or price column')
    }

    // Parse all rows
    const prices: CsvPricePoint[] = []
    const targetDateStr = format(date, 'yyyy-MM-dd')

    for (let i = 1; i < lines.length; i++) {
      const columns = lines[i].split(',')
      if (columns.length < 2) continue

      const rawTimestamp = columns[timestampIndex].trim()
      const rawPrice = columns[priceIndex].trim()

      // Only include rows for the target date
      if (!rawTimestamp.startsWith(targetDateStr)) continue

      const priceEurMwh = parseFloat(rawPrice)
      if (isNaN(priceEurMwh)) continue

      // Convert EUR/MWh to ct/kWh
      prices.push({
        timestamp: rawTimestamp,
        price_ct_kwh: priceEurMwh / 10
      })
    }

    return prices
  } catch (error) {
    console.error(`CSV parsing error for ${filename}:`, error)
    throw error
  }
}

/**
 * Check if CSV data exists for a given date and type
 */
export async function hasCsvData(
  type: 'day-ahead' | 'intraday',
  date: Date
): Promise<boolean> {
  const filename = getCsvFilename(date, type)
  const csvPath = getCsvPath(filename)

  try {
    const fs = await import('fs/promises')
    await fs.access(csvPath)
    return true
  } catch {
    return false
  }
}

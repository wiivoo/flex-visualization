/**
 * Batch Prices API Route
 * Effizientes Laden von Preisdaten für lange Zeiträume.
 *
 * Statt einzelne Tage abzufragen, werden SMARD-Wochen parallel geladen
 * (max ~52 Requests für ein ganzes Jahr statt 365).
 *
 * Fallback-Kette: Cache → SMARD → CSV → Demo-Daten
 *
 * Query params:
 * - startDate: YYYY-MM-DD (Pflicht)
 * - endDate: YYYY-MM-DD (Pflicht)
 * - type: day-ahead | intraday | forward (default: day-ahead)
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  parseISO,
  format,
  eachDayOfInterval,
  startOfDay,
  addMinutes,
  getMonth,
  differenceInDays,
  isBefore,
  isAfter,
  isEqual,
} from 'date-fns'
import { convertSmardPrice, SMARD_FILTER, SMARD_RESOLUTION } from '@/lib/smard'
import type { SmardPricePoint } from '@/lib/smard'
import { fetchAwattarRange } from '@/lib/awattar'
import { fetchEnergyChartsRange } from '@/lib/energy-charts'
import { fetchCsvPrices } from '@/lib/csv-prices'
import { getCachedPrices, setCachedPrices } from '@/lib/price-cache'

const SMARD_BASE_URL = 'https://www.smard.de/app/chart_data'

// Zod-Validierung der Query-Parameter
const batchQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate muss im Format YYYY-MM-DD sein'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate muss im Format YYYY-MM-DD sein'),
  type: z.enum(['day-ahead', 'intraday', 'forward']).default('day-ahead'),
})

interface PricePoint {
  timestamp: string
  price_ct_kwh: number
}

// --- SMARD Batch-Funktionen ---

/**
 * SMARD-Index laden: Liefert alle verfügbaren Wochen-Timestamps
 */
async function fetchSmardIndex(): Promise<number[]> {
  const url = `${SMARD_BASE_URL}/${SMARD_FILTER.PRICE_DE_LU}/index_${SMARD_RESOLUTION.HOUR}.json`
  const response = await fetch(url, { next: { revalidate: 3600 } })

  if (!response.ok) {
    throw new Error(`SMARD Index-Anfrage fehlgeschlagen: ${response.status}`)
  }

  const timestamps: number[] = await response.json()
  if (!timestamps || timestamps.length === 0) {
    throw new Error('Keine SMARD-Timestamps verfügbar')
  }

  return timestamps
}

/**
 * Finde alle Wochen-Timestamps, die den Zeitraum [startDate, endDate] abdecken
 */
function findOverlappingWeekTimestamps(
  allTimestamps: number[],
  startMs: number,
  endMs: number
): number[] {
  // Sortiere aufsteigend
  const sorted = [...allTimestamps].sort((a, b) => a - b)

  const result: number[] = []
  for (let i = 0; i < sorted.length; i++) {
    const weekStart = sorted[i]
    // Wochenende = nächster Timestamp - 1ms, oder +7 Tage wenn letzter Eintrag
    const weekEnd = i < sorted.length - 1
      ? sorted[i + 1] - 1
      : weekStart + 7 * 24 * 60 * 60 * 1000

    // Prüfe Überlappung mit [startMs, endMs]
    if (weekStart <= endMs && weekEnd >= startMs) {
      result.push(weekStart)
    }
  }

  return result
}

/**
 * Einzelne SMARD-Woche laden
 */
async function fetchSmardWeek(timestamp: number): Promise<SmardPricePoint[]> {
  const url = `${SMARD_BASE_URL}/${SMARD_FILTER.PRICE_DE_LU}/${SMARD_FILTER.PRICE_DE_LU}_${timestamp}_${SMARD_RESOLUTION.HOUR}.json`
  const response = await fetch(url, { next: { revalidate: 3600 } })

  if (!response.ok) {
    throw new Error(`SMARD Wochen-Daten fehlgeschlagen für ${timestamp}: ${response.status}`)
  }

  const data = await response.json()

  if (data.series && Array.isArray(data.series)) {
    return data.series.map((entry: [number, number | null]) => ({
      timestamp: entry[0],
      price_eur_mwh: entry[1],
    }))
  }

  return data.data || []
}

/**
 * Alle relevanten SMARD-Wochen parallel laden und auf Zeitraum filtern
 */
async function fetchSmardBatch(
  startDate: Date,
  endDate: Date
): Promise<PricePoint[] | null> {
  try {
    const index = await fetchSmardIndex()

    const startMs = startOfDay(startDate).getTime()
    const endMs = startOfDay(endDate).getTime() + 24 * 60 * 60 * 1000 - 1 // Ende des Tages

    const weekTimestamps = findOverlappingWeekTimestamps(index, startMs, endMs)

    if (weekTimestamps.length === 0) {
      return null
    }

    // Parallel laden (max ~52 Requests für ein Jahr)
    const weekResults = await Promise.allSettled(
      weekTimestamps.map(ts => fetchSmardWeek(ts))
    )

    // Alle erfolgreichen Ergebnisse zusammenführen
    const allPoints: SmardPricePoint[] = []
    for (const result of weekResults) {
      if (result.status === 'fulfilled') {
        allPoints.push(...result.value)
      }
    }

    if (allPoints.length === 0) {
      return null
    }

    // Auf exakten Zeitraum filtern und konvertieren
    const filtered = allPoints
      .filter(p => {
        if (p.price_eur_mwh === null) return false
        return p.timestamp >= startMs && p.timestamp <= endMs
      })
      .map(p => {
        const converted = convertSmardPrice(p)
        return {
          timestamp: converted.timestamp,
          price_ct_kwh: converted.price_ct_kwh ?? 0,
        }
      })
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    return filtered.length > 0 ? filtered : null
  } catch (error) {
    console.error('SMARD Batch-Fehler:', error)
    return null
  }
}

// --- aWATTar Batch-Funktion ---

/**
 * aWATTar-Preise für gesamten Zeitraum laden (native Bereichsabfrage)
 */
async function fetchAwattarBatch(
  startDate: Date,
  endDate: Date
): Promise<PricePoint[] | null> {
  try {
    const prices = await fetchAwattarRange(startDate, endDate)
    return prices.length > 0 ? prices : null
  } catch (error) {
    console.error('aWATTar Batch-Fehler:', error)
    return null
  }
}

// --- Energy-Charts Batch-Funktion ---

/**
 * Energy-Charts-Preise für gesamten Zeitraum laden (native Bereichsabfrage)
 */
async function fetchEnergyChartsBatch(
  startDate: Date,
  endDate: Date
): Promise<PricePoint[] | null> {
  try {
    const prices = await fetchEnergyChartsRange(startDate, endDate)
    return prices.length > 0 ? prices : null
  } catch (error) {
    console.error('Energy-Charts Batch-Fehler:', error)
    return null
  }
}

// --- CSV Batch-Funktion ---

/**
 * CSV-Daten für alle Tage im Zeitraum laden
 */
async function fetchCsvBatch(
  startDate: Date,
  endDate: Date,
  type: 'day-ahead' | 'intraday'
): Promise<PricePoint[] | null> {
  try {
    const days = eachDayOfInterval({ start: startDate, end: endDate })
    const allPrices: PricePoint[] = []

    // Sequentiell laden (CSV liest aus lokalen Dateien, ist schnell genug)
    for (const day of days) {
      try {
        const csvPrices = await fetchCsvPrices(type, day)
        allPrices.push(...csvPrices)
      } catch {
        // Tag überspringen, wenn CSV nicht verfügbar
      }
    }

    return allPrices.length > 0 ? allPrices : null
  } catch (error) {
    console.error('CSV Batch-Fehler:', error)
    return null
  }
}

// --- Demo-Daten ---

/**
 * Realistische Demo-Preise für gesamten Zeitraum generieren.
 * Berücksichtigt saisonale Schwankungen (Winter teurer, Sommer günstiger).
 */
function generateDemoBatchPrices(startDate: Date, endDate: Date): PricePoint[] {
  const prices: PricePoint[] = []
  const days = eachDayOfInterval({ start: startDate, end: endDate })

  // Seed-Funktion für wiederholbare Pseudo-Zufallszahlen
  function seededRandom(seed: number): number {
    const x = Math.sin(seed) * 10000
    return x - Math.floor(x)
  }

  for (const day of days) {
    const month = getMonth(day) // 0-11
    const dayOfYear = differenceInDays(day, new Date(day.getFullYear(), 0, 1))

    // Saisonaler Faktor: Winter (Dez-Feb) teurer, Sommer (Jun-Aug) günstiger
    let seasonalFactor = 1.0
    if (month >= 11 || month <= 1) {
      seasonalFactor = 1.3 // Winter: +30%
    } else if (month >= 5 && month <= 7) {
      seasonalFactor = 0.7 // Sommer: -30% (Solar-Überschuss)
    } else if (month >= 2 && month <= 4) {
      seasonalFactor = 0.9 // Frühling
    } else {
      seasonalFactor = 1.1 // Herbst
    }

    for (let hour = 0; hour < 24; hour++) {
      const time = addMinutes(startOfDay(day), hour * 60)
      const seed = dayOfYear * 100 + hour + day.getFullYear()

      // Tages-Pattern (ct/kWh)
      let basePrice: number
      if (hour >= 22 || hour < 6) {
        basePrice = 8 + seededRandom(seed) * 10 // Nacht: 8-18
      } else if (hour >= 6 && hour < 12) {
        basePrice = 18 + seededRandom(seed + 1) * 15 // Morgen: 18-33
      } else if (hour >= 12 && hour < 18) {
        basePrice = 15 + seededRandom(seed + 2) * 12 // Mittag: 15-27 (Solar)
      } else {
        basePrice = 28 + seededRandom(seed + 3) * 25 // Abend-Peak: 28-53
      }

      basePrice *= seasonalFactor

      // Wochenend-Rabatt
      const dayOfWeek = day.getDay()
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        basePrice *= 0.85
      }

      prices.push({
        timestamp: time.toISOString(),
        price_ct_kwh: Math.round(basePrice * 100) / 100,
      })
    }
  }

  return prices
}

// --- Cache-Funktionen für Batch ---

/**
 * Prüfe welche Tage bereits im Cache sind
 */
async function getCachedDays(
  startDate: Date,
  endDate: Date,
  type: 'day-ahead' | 'intraday' | 'forward'
): Promise<Map<string, PricePoint[]>> {
  const cachedDays = new Map<string, PricePoint[]>()
  const days = eachDayOfInterval({ start: startDate, end: endDate })

  // Parallel alle Tage abfragen
  const results = await Promise.allSettled(
    days.map(async day => {
      const dateStr = format(day, 'yyyy-MM-dd')
      const cached = await getCachedPrices(dateStr, type)
      return { dateStr, cached }
    })
  )

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.cached) {
      const { dateStr, cached } = result.value
      cachedDays.set(
        dateStr,
        cached.prices_json.map(p => ({
          timestamp: p.timestamp,
          price_ct_kwh: p.price_ct_kwh ?? 0,
        }))
      )
    }
  }

  return cachedDays
}

/**
 * Neue Preisdaten tageweise im Cache speichern
 */
async function cachePricesByDay(
  prices: PricePoint[],
  type: 'day-ahead' | 'intraday' | 'forward',
  source: 'awattar' | 'smard' | 'energy-charts' | 'csv'
): Promise<void> {
  // Preise nach Tag gruppieren
  const byDay = new Map<string, PricePoint[]>()

  for (const price of prices) {
    const dateStr = format(new Date(price.timestamp), 'yyyy-MM-dd')
    if (!byDay.has(dateStr)) {
      byDay.set(dateStr, [])
    }
    byDay.get(dateStr)!.push(price)
  }

  // Parallel speichern
  await Promise.allSettled(
    Array.from(byDay.entries()).map(([dateStr, dayPrices]) =>
      setCachedPrices(dateStr, type, source, dayPrices)
    )
  )
}

// --- API Route ---

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams

  // Zod-Validierung
  const parseResult = batchQuerySchema.safeParse({
    startDate: searchParams.get('startDate'),
    endDate: searchParams.get('endDate'),
    type: searchParams.get('type') || 'day-ahead',
  })

  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: 'Ungültige Parameter',
        details: parseResult.error.issues.map(i => i.message),
      },
      { status: 400 }
    )
  }

  const { startDate: startDateStr, endDate: endDateStr, type } = parseResult.data

  const startDate = parseISO(startDateStr)
  const endDate = parseISO(endDateStr)

  // Datumsvalidierung
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return NextResponse.json(
      { error: 'Ungültiges Datumsformat. Verwende YYYY-MM-DD' },
      { status: 400 }
    )
  }

  if (isAfter(startDate, endDate)) {
    return NextResponse.json(
      { error: 'startDate muss vor endDate liegen' },
      { status: 400 }
    )
  }

  // Maximal 400 Tage (etwas mehr als 1 Jahr)
  const dayCount = differenceInDays(endDate, startDate) + 1
  if (dayCount > 400) {
    return NextResponse.json(
      { error: 'Maximaler Zeitraum: 400 Tage' },
      { status: 400 }
    )
  }

  // Schritt 1: Cache prüfen
  const cachedDays = await getCachedDays(startDate, endDate, type)
  const allDays = eachDayOfInterval({ start: startDate, end: endDate })
  const uncachedDays = allDays.filter(d => !cachedDays.has(format(d, 'yyyy-MM-dd')))

  // Wenn alles im Cache ist, direkt zurückgeben
  if (uncachedDays.length === 0) {
    const allPrices: PricePoint[] = []
    for (const day of allDays) {
      const dayPrices = cachedDays.get(format(day, 'yyyy-MM-dd'))
      if (dayPrices) allPrices.push(...dayPrices)
    }

    return NextResponse.json({
      type,
      startDate: startDateStr,
      endDate: endDateStr,
      source: 'cache',
      count: allPrices.length,
      prices: allPrices,
    })
  }

  // Schritt 2: Fehlende Daten laden
  let fetchedPrices: PricePoint[] | null = null
  let source: 'awattar' | 'smard' | 'energy-charts' | 'csv' | 'demo' = 'demo'

  // Nur fehlende Tage laden: Berechne Zeitraum der fehlenden Tage
  const uncachedStart = uncachedDays[0]
  const uncachedEnd = uncachedDays[uncachedDays.length - 1]

  if (type === 'day-ahead') {
    // Schritt 2a: aWATTar (native Bereichsabfrage, schnellste Quelle)
    fetchedPrices = await fetchAwattarBatch(uncachedStart, uncachedEnd)
    if (fetchedPrices && fetchedPrices.length > 0) {
      source = 'awattar'
    } else {
      // Schritt 2b: SMARD API (wochenweise, parallel)
      fetchedPrices = await fetchSmardBatch(uncachedStart, uncachedEnd)
      if (fetchedPrices && fetchedPrices.length > 0) {
        source = 'smard'
      } else {
        // Schritt 2c: Energy-Charts (native Bereichsabfrage)
        fetchedPrices = await fetchEnergyChartsBatch(uncachedStart, uncachedEnd)
        if (fetchedPrices && fetchedPrices.length > 0) {
          source = 'energy-charts'
        } else {
          // Schritt 2d: CSV Fallback
          fetchedPrices = await fetchCsvBatch(uncachedStart, uncachedEnd, 'day-ahead')
          if (fetchedPrices && fetchedPrices.length > 0) {
            source = 'csv'
          }
        }
      }
    }
  } else {
    // Intraday/Forward: Nur CSV
    const csvType = type === 'forward' ? 'day-ahead' : (type as 'day-ahead' | 'intraday')
    fetchedPrices = await fetchCsvBatch(uncachedStart, uncachedEnd, csvType)
    if (fetchedPrices && fetchedPrices.length > 0) {
      source = 'csv'
    }
  }

  // Schritt 2c: Demo-Daten Fallback
  if (!fetchedPrices || fetchedPrices.length === 0) {
    fetchedPrices = generateDemoBatchPrices(uncachedStart, uncachedEnd)
    source = 'demo'
  }

  // Schritt 3: Cache aktualisieren (Demo-Daten nicht cachen)
  if (source !== 'demo' && fetchedPrices.length > 0) {
    try {
      await cachePricesByDay(fetchedPrices, type, source)
    } catch (error) {
      console.error('Batch-Cache-Schreibfehler (nicht kritisch):', error)
    }
  }

  // Schritt 4: Cache + frisch geladene Daten zusammenführen
  const allPrices: PricePoint[] = []

  for (const day of allDays) {
    const dateStr = format(day, 'yyyy-MM-dd')
    const cached = cachedDays.get(dateStr)
    if (cached) {
      allPrices.push(...cached)
    } else {
      // Aus fetchedPrices die Daten für diesen Tag extrahieren
      const dayStart = startOfDay(day).getTime()
      const dayEnd = dayStart + 24 * 60 * 60 * 1000 - 1
      const dayPrices = fetchedPrices.filter(p => {
        const ts = new Date(p.timestamp).getTime()
        return ts >= dayStart && ts <= dayEnd
      })
      allPrices.push(...dayPrices)
    }
  }

  return NextResponse.json({
    type,
    startDate: startDateStr,
    endDate: endDateStr,
    source: cachedDays.size > 0 ? `mixed (${cachedDays.size} cached)` : source,
    count: allPrices.length,
    prices: allPrices,
  })
}

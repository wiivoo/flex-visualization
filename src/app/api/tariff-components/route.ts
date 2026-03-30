import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * GET /api/tariff-components?plz=XXXXX
 *
 * Returns regional electricity tariff components (grid fee, taxes/surcharges)
 * for a German postal code. Data sourced from a public price overview endpoint.
 *
 * Response: {
 *   plz: string,
 *   location: string,
 *   gridFeeNetto: number,     // ct/kWh excl. VAT
 *   taxesNetto: number,       // ct/kWh excl. VAT (Stromsteuer + Umlagen + Konzessionsabgabe)
 *   gridFeeBrutto: number,    // ct/kWh incl. VAT
 *   taxesBrutto: number,      // ct/kWh incl. VAT
 *   defaultSupplier: string,  // local Grundversorger name
 *   cached: boolean,
 * }
 */

const LOOKUP_BASE = 'https://tibber.com/de/api/lookup'
const CACHE_TTL_MS = 7 * 86400000 // 7 days — grid fees change annually

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

function getSupabase() {
  if (!supabaseUrl || !supabaseKey) return null
  return createClient(supabaseUrl, supabaseKey)
}

interface PriceComponent {
  type: 'power' | 'taxes' | 'grid'
  priceExcludingVat: number
  priceIncludingVat: number
}

interface HourEntry {
  priceComponents: PriceComponent[]
  date: string
  hour: number
}

interface CompetitorCost {
  competitorName: string
  competitorType: string
  assumedConsumption: number
  energyTotal: number        // brutto EUR/yr
  energyTotalExVat: number
  fixedFees: number          // brutto EUR/yr (standing charge)
  fixedFeesExVat: number
  yearlyTotal: number        // brutto EUR/yr
  yearlyTotalExVat: number
}

interface PriceOverview {
  energy: {
    yesterdayHours?: HourEntry[]
    todayHours?: HourEntry[]
  }
  annualCompetitorCost?: CompetitorCost[]
}

interface LocationResult {
  result: string
  valid: boolean
}

export async function GET(req: NextRequest) {
  const plz = req.nextUrl.searchParams.get('plz')?.trim()

  if (!plz || !/^\d{5}$/.test(plz)) {
    return NextResponse.json({ error: 'Invalid PLZ. Must be 5 digits.' }, { status: 400 })
  }

  // Check cache first
  const supabase = getSupabase()
  if (supabase) {
    const { data: cached } = await supabase
      .from('price_cache')
      .select('cached_at, prices_json')
      .eq('date', plz)
      .eq('type', 'tariff-components')
      .single()

    if (cached?.prices_json) {
      const age = Date.now() - new Date(cached.cached_at).getTime()
      if (age < CACHE_TTL_MS) {
        return NextResponse.json({ ...cached.prices_json, cached: true })
      }
    }
  }

  try {
    // Fetch location name and price overview in parallel
    const [locationRes, priceRes] = await Promise.all([
      fetch(`${LOOKUP_BASE}/location?postalCode=${plz}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      }),
      fetch(`${LOOKUP_BASE}/price-overview?postalCode=${plz}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      }),
    ])

    if (!priceRes.ok) {
      return NextResponse.json(
        { error: `Price lookup failed (${priceRes.status})` },
        { status: 502 }
      )
    }

    const locationData: LocationResult | null = locationRes.ok
      ? await locationRes.json()
      : null
    const priceData: PriceOverview = await priceRes.json()

    // Extract components from the first available hour
    const hours = priceData.energy?.yesterdayHours ?? priceData.energy?.todayHours ?? []
    if (hours.length === 0) {
      return NextResponse.json(
        { error: 'No price data available for this PLZ' },
        { status: 404 }
      )
    }

    const first = hours[0]
    const gridComp = first.priceComponents.find(c => c.type === 'grid')
    const taxesComp = first.priceComponents.find(c => c.type === 'taxes')

    if (!gridComp || !taxesComp) {
      return NextResponse.json(
        { error: 'Missing price components' },
        { status: 502 }
      )
    }

    // Grid fee and taxes are constant across all hours (verified)
    // Build competitor tariff list from Tibber data
    const competitors = (priceData.annualCompetitorCost ?? []).map(c => {
      const consumption = c.assumedConsumption || 2500
      const ctKwh = consumption > 0 ? Math.round((c.energyTotal / consumption) * 10000) / 100 : 0
      return {
        name: c.competitorName,
        type: c.competitorType,
        ctKwh,
        standingChargeEur: Math.round(c.fixedFees * 100) / 100,
        yearlyTotalEur: Math.round(c.yearlyTotal * 100) / 100,
        consumption,
        source: 'tibber' as string,
      }
    })

    // Enrich with Octopus Energy Kraken API (Grundversorger tariff details)
    try {
      const krakenRes = await fetch('https://api.oeg-kraken.energy/v1/graphql/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `{
            defaultElectricitySuppliers(postcode: "${plz}", annualConsumption: 2500) {
              supplierName
              tariffs {
                tariffName
                unitRatePerKwh
                annualStandingCharge
                totalEstimatedAnnualBill
              }
            }
          }`,
        }),
      })
      if (krakenRes.ok) {
        const krakenData = await krakenRes.json()
        const suppliers = krakenData?.data?.defaultElectricitySuppliers
        if (Array.isArray(suppliers)) {
          for (const s of suppliers) {
            const tariff = s.tariffs?.[0] // Take first (standard) tariff
            if (!tariff) continue
            // unitRatePerKwh is EUR/kWh gross (e.g. 0.3465)
            const ctKwh = tariff.unitRatePerKwh ? Math.round(parseFloat(tariff.unitRatePerKwh) * 10000) / 100 : 0
            // annualStandingCharge is EUR/yr gross
            const standingChargeEur = tariff.annualStandingCharge ? Math.round(parseFloat(tariff.annualStandingCharge) * 100) / 100 : 0
            const yearlyTotal = tariff.totalEstimatedAnnualBill ? Math.round(parseFloat(tariff.totalEstimatedAnnualBill) * 100) / 100 : 0
            // Only add if we don't already have this supplier from Tibber
            const firstWord = s.supplierName?.split(' ')[0]?.toLowerCase() || '___'
            const alreadyHas = competitors.some(c => c.name.toLowerCase().includes(firstWord))
            if (!alreadyHas && ctKwh > 0) {
              competitors.push({
                name: `${s.supplierName} — ${tariff.tariffName}`,
                type: 'grundversorgung',
                ctKwh,
                standingChargeEur,
                yearlyTotalEur: yearlyTotal,
                consumption: 2500,
                source: 'octopus' as string,
              })
            }
          }
        }
      }
    } catch {
      // Octopus enrichment is best-effort
    }

    const result = {
      plz,
      location: locationData?.valid ? locationData.result : 'Unknown',
      gridFeeNetto: Math.round(gridComp.priceExcludingVat * 10000) / 100,   // EUR → ct/kWh
      taxesNetto: Math.round(taxesComp.priceExcludingVat * 10000) / 100,
      gridFeeBrutto: Math.round(gridComp.priceIncludingVat * 10000) / 100,
      taxesBrutto: Math.round(taxesComp.priceIncludingVat * 10000) / 100,
      defaultSupplier: priceData.annualCompetitorCost?.find(
        c => c.competitorType === 'default supplier'
      )?.competitorName ?? 'Unknown',
      competitors,
      cached: false,
    }

    // Cache in Supabase
    if (supabase) {
      await supabase
        .from('price_cache')
        .upsert(
          {
            date: plz,
            type: 'tariff-components',
            cached_at: new Date().toISOString(),
            source: 'price-lookup',
            prices_json: result,
          },
          { onConflict: 'date,type' }
        )
        .then(() => {})
    }

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: `Lookup failed: ${err instanceof Error ? err.message : 'unknown'}` },
      { status: 502 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { nlProvinceToDso, NL_DYNAMIC_COMPETITORS, NL_FIXED_COMPETITORS } from '@/lib/nl-tariff'

/**
 * GET /api/nl-tariff-components?postcode=1234AB
 *
 * Returns NL electricity tariff components for a Dutch postcode:
 *   - Location (city, province, municipality) via PDOK
 *   - DSO (Liander/Stedin/Enexis) with capacity-based grid fees
 *   - Dynamic tariff competitor list
 *   - Live spot price reference from Frank Energie
 *
 * NL postcodes: 4 digits + 2 letters (e.g. 1012AB)
 */

const NL_POSTCODE_REGEX = /^\d{4}\s?[A-Za-z]{2}$/
const CACHE_TTL_MS = 7 * 86400000 // 7 days

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

function getSupabase() {
  if (!supabaseUrl || !supabaseKey) return null
  return createClient(supabaseUrl, supabaseKey)
}

interface PdokDoc {
  type: string
  weergavenaam: string
  provincienaam?: string
  gemeentenaam?: string
  woonplaatsnaam?: string
  postcode?: string
}

export async function GET(req: NextRequest) {
  const rawPostcode = req.nextUrl.searchParams.get('postcode')?.trim().toUpperCase().replace(/\s/g, '')

  if (!rawPostcode || !NL_POSTCODE_REGEX.test(rawPostcode)) {
    return NextResponse.json(
      { error: 'Invalid postcode. Must be Dutch format (e.g. 1012AB).' },
      { status: 400 }
    )
  }

  // Normalize: "1012AB"
  const postcode = rawPostcode.slice(0, 4) + rawPostcode.slice(4).toUpperCase()

  // Check cache
  const supabase = getSupabase()
  if (supabase) {
    const { data: cached } = await supabase
      .from('price_cache')
      .select('cached_at, prices_json')
      .eq('date', `nl:${postcode}`)
      .eq('type', 'nl-tariff-components')
      .single()

    if (cached?.prices_json) {
      const age = Date.now() - new Date(cached.cached_at).getTime()
      if (age < CACHE_TTL_MS) {
        return NextResponse.json({ ...cached.prices_json, cached: true })
      }
    }
  }

  try {
    // Fetch location from PDOK and live prices from Frank Energie in parallel
    const [pdokRes, frankRes] = await Promise.all([
      fetch(
        `https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?q=postcode:${postcode.slice(0, 4)}&fq=type:postcode&rows=1`,
        { headers: { Accept: 'application/json' } }
      ),
      fetch('https://frank-graphql-prod.graphcdn.app/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `query {
            marketPricesElectricity(startDate: "${new Date().toISOString().slice(0, 10)}", endDate: "${new Date(Date.now() + 86400000).toISOString().slice(0, 10)}") {
              from till
              marketPrice marketPriceTax
              energyTaxPrice
              allInPrice
            }
          }`,
        }),
      }).catch(() => null),
    ])

    // Parse PDOK location
    let city = 'Unknown'
    let province = 'Unknown'
    let municipality = 'Unknown'
    let dsoInfo = null

    if (pdokRes.ok) {
      const pdokData = await pdokRes.json()
      const doc: PdokDoc | undefined = pdokData?.response?.docs?.[0]
      if (doc) {
        city = doc.woonplaatsnaam || 'Unknown'
        province = doc.provincienaam || 'Unknown'
        municipality = doc.gemeentenaam || 'Unknown'
        dsoInfo = nlProvinceToDso(province)
      }
    }

    // Parse Frank Energie live prices
    let frankAvgAllIn: number | null = null
    let frankAvgSpot: number | null = null
    try {
      if (frankRes?.ok) {
        const frankData = await frankRes.json()
        const prices = frankData?.data?.marketPricesElectricity
        if (Array.isArray(prices) && prices.length > 0) {
          const validPrices = prices.filter((p: { allInPrice: number }) => p.allInPrice != null)
          if (validPrices.length > 0) {
            frankAvgAllIn = validPrices.reduce((s: number, p: { allInPrice: number }) => s + p.allInPrice, 0) / validPrices.length * 100 // EUR → ct
            frankAvgSpot = validPrices.reduce((s: number, p: { marketPrice: number }) => s + p.marketPrice, 0) / validPrices.length * 100
          }
        }
      }
    } catch { /* best-effort */ }

    const result = {
      postcode,
      city,
      province,
      municipality,
      dso: dsoInfo ? {
        name: dsoInfo.name,
        code: dsoInfo.code,
        monthlyGridFee1x25A: dsoInfo.monthlyGridFee1x25A,
        monthlyGridFee3x25A: dsoInfo.monthlyGridFee3x25A,
        monthlyGridFee3x35A: dsoInfo.monthlyGridFee3x35A,
      } : null,
      // Live reference prices from Frank Energie
      frankEnergie: frankAvgAllIn != null ? {
        avgAllInCtKwh: Math.round(frankAvgAllIn * 100) / 100,
        avgSpotCtKwh: frankAvgSpot != null ? Math.round(frankAvgSpot * 100) / 100 : null,
        date: new Date().toISOString().slice(0, 10),
      } : null,
      // Competitor tariffs
      dynamicProviders: NL_DYNAMIC_COMPETITORS.map(c => ({
        name: c.name,
        monthlyFeeEur: c.monthlyFeeEur,
        marginCtKwh: c.marginCtKwh,
        isGreen: c.isGreen,
        source: c.source,
      })),
      fixedProviders: NL_FIXED_COMPETITORS.map(c => ({
        name: c.name,
        monthlyFeeEur: c.monthlyFeeEur,
        fixedCtKwh: c.fixedCtKwh,
        isGreen: c.isGreen,
        source: c.source,
      })),
      cached: false,
    }

    // Cache in Supabase
    if (supabase) {
      await supabase
        .from('price_cache')
        .upsert(
          {
            date: `nl:${postcode}`,
            type: 'nl-tariff-components',
            cached_at: new Date().toISOString(),
            source: 'nl-tariff-lookup',
            prices_json: result,
          },
          { onConflict: 'date,type' }
        )
        .then(() => {})
    }

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: `NL lookup failed: ${err instanceof Error ? err.message : 'unknown'}` },
      { status: 502 }
    )
  }
}

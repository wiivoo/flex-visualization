import { NextRequest, NextResponse } from 'next/server'

/**
 * PVGIS API for monthly PV radiation data
 * Documentation: https://re.jrc.ec.europa.eu/api/v5_2/
 *
 * For German zip codes, we use a simple lat/lon approximation based on
 * the first digit of the zip code (postal region).
 */

// German postal code regions to approximate lat/lon
// Germany uses 5-digit zip codes where the first digit indicates the region
const DE_POSTAL_REGIONS: Record<string, { lat: number; lon: number; region: string }> = {
  '0': { lat: 51.5, lon: 13.5, region: 'Dresden/Leipzig (East)' },
  '1': { lat: 52.5, lon: 13.4, region: 'Berlin/Northeast' },
  '2': { lat: 53.55, lon: 10.0, region: 'Hamburg/North' },
  '3': { lat: 52.37, lon: 9.74, region: 'Hannover/Central North' },
  '4': { lat: 51.45, lon: 6.85, region: 'Düsseldorf/Ruhr (West)' },
  '5': { lat: 50.94, lon: 6.96, region: 'Cologne/Bonn (West)' },
  '6': { lat: 50.11, lon: 8.68, region: 'Frankfurt/Central West' },
  '7': { lat: 48.78, lon: 9.18, region: 'Stuttgart/Southwest' },
  '8': { lat: 48.14, lon: 11.58, region: 'Munich/Southeast' },
  '9': { lat: 49.45, lon: 11.07, region: 'Nuremberg/South' },
}

/**
 * Convert German zip code to approximate lat/lon
 * Uses the first digit to determine the postal region
 */
function zipCodeToLatLon(zipCode: string): { lat: number; lon: number; region: string } | null {
  const firstDigit = zipCode.charAt(0)
  return DE_POSTAL_REGIONS[firstDigit] || null
}

/**
 * Fetch monthly radiation data from PVGIS API
 */
async function fetchPvgisData(lat: number, lon: number, peakPowerKwp: number): Promise<{
  monthlyRadiation: number[]
  annualTotal: number
  error?: string
} | null> {
  try {
    // PVGIS API: https://re.jrc.ec.europa.eu/api/v5_2/monthlydata
    const params = new URLSearchParams({
      lat: lat.toFixed(4),
      lon: lon.toFixed(4),
      peakpower: peakPowerKwp.toString(),
      loss: '14', // Default system losses (14%)
      raddatabase: 'PVGIS-SARAH3', // Satellite-based radiation database
      outputformat: 'json',
    })

    const url = `https://re.jrc.ec.europa.eu/api/v5_2/monthlydata?${params}`
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
      // Cache for 24 hours - radiation data doesn't change frequently
      next: { revalidate: 86400 },
    })

    if (!response.ok) {
      console.error(`PVGIS API error: ${response.status} ${response.statusText}`)
      return null
    }

    const data = await response.json()

    // Parse PVGIS response
    if (data.inputs && data.outputs && data.outputs.monthly) {
      const monthlyRadiation = data.outputs.monthly.map(
        (month: { Irradiation: number }) => month.Irradiation
      )
      const annualTotal = monthlyRadiation.reduce((sum: number, val: number) => sum + val, 0)

      return {
        monthlyRadiation,
        annualTotal,
      }
    }

    return null
  } catch (error) {
    console.error('PVGIS API fetch error:', error)
    return null
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const zipCode = searchParams.get('zip')
  const peakPowerKwp = parseFloat(searchParams.get('peakPower') || '10')

  // Validate zip code (German 5-digit format)
  if (!zipCode || !/^\d{5}$/.test(zipCode)) {
    return NextResponse.json(
      { error: 'Invalid German zip code. Expected 5 digits (e.g., 10115)' },
      { status: 400 }
    )
  }

  // Validate peak power
  if (!isFinite(peakPowerKwp) || peakPowerKwp <= 0 || peakPowerKwp > 100) {
    return NextResponse.json(
      { error: 'Peak power must be between 0 and 100 kWp' },
      { status: 400 }
    )
  }

  // Convert zip code to lat/lon
  const location = zipCodeToLatLon(zipCode)
  if (!location) {
    return NextResponse.json(
      { error: 'Could not determine location from zip code' },
      { status: 400 }
    )
  }

  // Fetch radiation data from PVGIS
  const pvgisData = await fetchPvgisData(location.lat, location.lon, peakPowerKwp)

  if (!pvgisData) {
    return NextResponse.json(
      {
        zipCode,
        location: {
          lat: location.lat,
          lon: location.lon,
          region: location.region,
        },
        peakPowerKwp,
        // Return default monthly distribution (German average)
        monthlyRadiation: getDefaultMonthlyRadiation(),
        annualTotal: getDefaultAnnualTotal(),
        isDefault: true,
        fallbackReason: 'Could not fetch radiation data from PVGIS. Using default values.',
      },
      { status: 200 }
    )
  }

  return NextResponse.json({
    zipCode,
    location: {
      lat: location.lat,
      lon: location.lon,
      region: location.region,
    },
    peakPowerKwp,
    monthlyRadiation: pvgisData.monthlyRadiation,
    annualTotal: pvgisData.annualTotal,
    isDefault: false,
  })
}

/**
 * Default monthly radiation distribution for Germany (kWh/kWp per month)
 * Based on long-term averages from PVGIS
 */
function getDefaultMonthlyRadiation(): number[] {
  return [
    45,   // January
    65,   // February
    95,   // March
    125,  // April
    155,  // May
    165,  // June
    160,  // July
    140,  // August
    105,  // September
    70,   // October
    45,   // November
    35,   // December
  ]
}

function getDefaultAnnualTotal(): number {
  // Typical German PV yield: ~1000 kWh/kWp per year
  return 1000
}

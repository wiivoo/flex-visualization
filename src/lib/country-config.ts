export type AppCountry = 'DE' | 'NL' | 'GB'

export function getEnableGb(): boolean {
  const value = process.env.ENABLE_GB
  return value === 'true'
}

export function getEnableIntraday(): boolean {
  const value = process.env.ENABLE_INTRADAY
  return value === 'true'
}

export function getEnabledCountries(enableGb: boolean): AppCountry[] {
  return enableGb ? ['DE', 'NL', 'GB'] : ['DE', 'NL']
}

export function isCountryEnabled(country: string, enableGb: boolean): country is AppCountry {
  return getEnabledCountries(enableGb).includes(country as AppCountry)
}

export function parseEnabledCountry(value: string | null | undefined, enableGb: boolean): AppCountry {
  return isCountryEnabled(value ?? '', enableGb) ? value as AppCountry : 'DE'
}

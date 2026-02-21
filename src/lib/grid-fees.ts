/**
 * §14a EnWG Modul 3 - Zeitvariable Netzentgelte
 *
 * Implementiert die zeitvariablen Netzentgelte nach §14a EnWG für
 * steuerbare Verbrauchseinrichtungen (z.B. E-Auto-Wallboxen).
 *
 * Drei Preiszonen:
 * - HT (Hochlast): Nachmittag/Abend-Spitze - höchstes Entgelt
 * - ST (Standard): Morgen/Abend - mittleres Entgelt
 * - NT (Niederlast): Nacht - niedrigstes Entgelt
 */

export type Tarifzone = 'HT' | 'ST' | 'NT'

export interface DsoTariff {
  HT: number // ct/kWh Hochlast
  ST: number // ct/kWh Standard
  NT: number // ct/kWh Niederlast
}

export interface QuarterValidity {
  Q1: boolean
  Q2: boolean
  Q3: boolean
  Q4: boolean
}

/**
 * DSO-Tarife für zeitvariable Netzentgelte (ct/kWh)
 * Quelle: Veröffentlichte Preisblätter der Netzbetreiber
 */
export const DSO_TARIFFS: Record<string, DsoTariff> = {
  'Westnetz': { HT: 15.65, ST: 9.53, NT: 0.95 },
  'Avacon': { HT: 8.41, ST: 6.04, NT: 0.60 },
  'MVV Netze': { HT: 5.96, ST: 4.32, NT: 1.73 },
  'MITNETZ': { HT: 12.60, ST: 6.31, NT: 0.69 },
  'Stadtwerke München': { HT: 7.14, ST: 6.47, NT: 2.59 },
  'Thüringer Energienetze': { HT: 8.62, ST: 5.56, NT: 1.67 },
  'LEW': { HT: 8.09, ST: 7.09, NT: 4.01 },
  'NetzeBW': { HT: 13.20, ST: 7.57, NT: 3.03 },
  'Bayernwerk': { HT: 9.03, ST: 4.72, NT: 0.47 },
  'EAM Netz': { HT: 10.52, ST: 5.48, NT: 1.64 },
} as const

/**
 * Quartals-Gültigkeit pro DSO.
 * Manche Netzbetreiber wenden Modul 3 nur in bestimmten Quartalen an.
 */
export const DSO_QUARTER_VALID: Record<string, QuarterValidity> = {
  'Westnetz': { Q1: true, Q2: true, Q3: true, Q4: true },
  'Avacon': { Q1: true, Q2: false, Q3: false, Q4: true },
  'MVV Netze': { Q1: true, Q2: true, Q3: true, Q4: true },
  'MITNETZ': { Q1: true, Q2: true, Q3: false, Q4: true },
  'Stadtwerke München': { Q1: true, Q2: true, Q3: true, Q4: true },
  'Thüringer Energienetze': { Q1: true, Q2: false, Q3: false, Q4: true },
  'LEW': { Q1: true, Q2: true, Q3: true, Q4: true },
  'NetzeBW': { Q1: true, Q2: true, Q3: true, Q4: true },
  'Bayernwerk': { Q1: true, Q2: false, Q3: false, Q4: true },
  'EAM Netz': { Q1: true, Q2: true, Q3: false, Q4: true },
}

/**
 * Stunden-Pattern für Tarifzonen (gleich für alle DSOs):
 *
 * 00-04: NT (Nacht)
 * 05-13: ST (Standard)
 * 14-20: HT (Hochlast/Peak)
 * 21-22: ST (Standard)
 * 23:    NT (Nacht)
 */
const HOURLY_ZONES: Tarifzone[] = [
  'NT', 'NT', 'NT', 'NT', 'NT',   // 00-04
  'ST', 'ST', 'ST', 'ST', 'ST',   // 05-09
  'ST', 'ST', 'ST', 'ST',         // 10-13
  'HT', 'HT', 'HT', 'HT', 'HT', // 14-18
  'HT', 'HT',                     // 19-20
  'ST', 'ST',                     // 21-22
  'NT',                           // 23
]

/**
 * Tarifzone für eine bestimmte Stunde ermitteln
 */
export function getTarifzone(hour: number): Tarifzone {
  if (hour < 0 || hour > 23) {
    throw new Error(`Ungültige Stunde: ${hour}. Muss zwischen 0 und 23 liegen.`)
  }
  return HOURLY_ZONES[hour]
}

/**
 * Netzentgelt für eine bestimmte Stunde und einen DSO ermitteln (ct/kWh).
 * Wenn der DSO nicht bekannt ist, wird 0 zurückgegeben.
 */
export function getGridFee(hour: number, dso: string): number {
  const tariff = DSO_TARIFFS[dso]
  if (!tariff) {
    console.warn(`Unbekannter DSO: ${dso}. Netzentgelt = 0`)
    return 0
  }

  const zone = getTarifzone(hour)
  return tariff[zone]
}

/**
 * Prüfe ob Modul 3 für einen DSO in einem bestimmten Monat aktiv ist.
 * Monat: 1-12 (Januar = 1)
 */
export function isModul3Active(dso: string, month: number): boolean {
  const validity = DSO_QUARTER_VALID[dso]
  if (!validity) {
    return false
  }

  // Monat → Quartal
  if (month >= 1 && month <= 3) return validity.Q1
  if (month >= 4 && month <= 6) return validity.Q2
  if (month >= 7 && month <= 9) return validity.Q3
  if (month >= 10 && month <= 12) return validity.Q4

  return false
}

/**
 * 24-Stunden Netzentgelt-Array für einen DSO (ct/kWh).
 * Index 0 = Stunde 0 (00:00), Index 23 = Stunde 23 (23:00).
 */
export function getDailyGridFees(dso: string): number[] {
  return Array.from({ length: 24 }, (_, hour) => getGridFee(hour, dso))
}

/**
 * Gesamtkosten berechnen inklusive Netzentgelt, Steuern und MwSt.
 *
 * Formel: (Börsenpreis + Netzentgelt + Steuern/Abgaben) * (1 + MwSt/100)
 *
 * @param priceCtKwh - Börsenstrompreis in ct/kWh
 * @param gridFeeCtKwh - Netzentgelt in ct/kWh
 * @param taxesCtKwh - Steuern, Abgaben, Umlagen in ct/kWh
 * @param vatPercent - Mehrwertsteuersatz in % (z.B. 19)
 * @returns Gesamtkosten in ct/kWh
 */
export function calculateTotalCost(
  priceCtKwh: number,
  gridFeeCtKwh: number,
  taxesCtKwh: number,
  vatPercent: number
): number {
  const nettoCtKwh = priceCtKwh + gridFeeCtKwh + taxesCtKwh
  const bruttoCtKwh = nettoCtKwh * (1 + vatPercent / 100)
  return Math.round(bruttoCtKwh * 100) / 100
}

/**
 * Liste aller verfügbaren DSOs
 */
export function getAvailableDSOs(): string[] {
  return Object.keys(DSO_TARIFFS)
}

/**
 * Durchschnittliches Netzentgelt für einen DSO über 24h (ct/kWh)
 * Nützlich für Vergleichsrechnungen ohne Modul 3
 */
export function getAverageGridFee(dso: string): number {
  const fees = getDailyGridFees(dso)
  const sum = fees.reduce((acc, fee) => acc + fee, 0)
  return Math.round((sum / 24) * 100) / 100
}

/**
 * Reduziertes Netzentgelt nach §14a (pauschaler Abzug, falls nicht Modul 3)
 * Standard-Reduktion: ca. 60% des regulären Netzentgelts
 */
export function getReducedGridFee(dso: string): number {
  return getAverageGridFee(dso)
}

/**
 * Shared types for the auditable Excel export builders.
 *
 * These builders produce workbooks where all derived numbers are Excel
 * formulas rather than precomputed values, so an analyst can verify the
 * math end-to-end without touching the app code.
 */

export interface RawPriceRow {
  date: string    // YYYY-MM-DD
  month: number   // 1..12
  day: number     // 1..31
  qh: number      // 0..95 (qh-of-day)
  hour: number    // 0..23
  minute: number  // 0, 15, 30, 45
  ctKwh: number   // EUR-cents per kWh (SMARD EUR/MWh / 10)
}

export interface ScenarioParams {
  yearlyMileageKm: number
  plugInTime: number         // hour 0..23
  windowLengthHours: number  // hours
  chargePowerKw: number
  plugInsPerWeek: number
}

export interface ExportResult {
  blob: Blob
  filename: string
}

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

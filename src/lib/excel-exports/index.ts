/**
 * Barrel re-exports for the excel-exports module.
 *
 * Callers should still use dynamic `import('@/lib/excel-exports/<builder>')`
 * in click handlers to keep `exceljs` out of the initial route bundle.
 */
export type { RawPriceRow, ScenarioParams, ExportResult } from './types'
export { exportPricePatternsXlsx } from './price-patterns'
export { exportSensitivityXlsx } from './sensitivity'
export { exportIdealParametersXlsx } from './ideal-parameters'

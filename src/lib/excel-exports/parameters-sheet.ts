/**
 * parameters sheet writer.
 *
 * Emits a two-column (name, value) sheet and registers a workbook-level
 * defined name for every row, so formulas on other sheets can reference
 * parameters by name (e.g. `=yearlyMileageKm`, `=chargePowerKw`).
 *
 * Derived cells (`energyPerSessionKwh`, `slotsNeeded`) are themselves
 * formulas so editing a source parameter propagates through the workbook.
 */
import type { Workbook, Worksheet } from 'exceljs'
import type { ScenarioParams } from './types'

/** Exported so other modules can reference the defined-name strings consistently. */
export const PARAM_NAMES = {
  yearlyMileageKm: 'yearlyMileageKm',
  plugInTime: 'plugInTime',
  windowLengthHours: 'windowLengthHours',
  chargePowerKw: 'chargePowerKw',
  plugInsPerWeek: 'plugInsPerWeek',
  kwhPer100km: 'kwhPer100km',
  energyPerSessionKwh: 'energyPerSessionKwh',
  slotsNeeded: 'slotsNeeded',
} as const

interface ParamRow {
  name: string
  value: number | { formula: string }
  numFmt?: string
  comment?: string
}

export function writeParametersSheet(
  workbook: Workbook,
  params: ScenarioParams,
): Worksheet {
  const ws = workbook.addWorksheet('parameters')
  ws.columns = [
    { header: 'name', key: 'name', width: 26 },
    { header: 'value', key: 'value', width: 14 },
    { header: 'note', key: 'note', width: 60 },
  ]
  ws.getRow(1).font = { bold: true }

  const rows: ParamRow[] = [
    { name: PARAM_NAMES.yearlyMileageKm, value: params.yearlyMileageKm, numFmt: '0', comment: 'Yearly driving distance (km)' },
    { name: PARAM_NAMES.plugInTime, value: params.plugInTime, numFmt: '0', comment: 'Plug-in hour (0..23)' },
    { name: PARAM_NAMES.windowLengthHours, value: params.windowLengthHours, numFmt: '0', comment: 'Plug-in to departure (hours)' },
    { name: PARAM_NAMES.chargePowerKw, value: params.chargePowerKw, numFmt: '0.0', comment: 'Wallbox power (kW)' },
    { name: PARAM_NAMES.plugInsPerWeek, value: params.plugInsPerWeek, numFmt: '0', comment: 'Charging sessions per week' },
    { name: PARAM_NAMES.kwhPer100km, value: 19, numFmt: '0', comment: 'Average consumption (kWh per 100 km)' },
    {
      name: PARAM_NAMES.energyPerSessionKwh,
      value: {
        formula: `${PARAM_NAMES.yearlyMileageKm}/(${PARAM_NAMES.plugInsPerWeek}*52)/100*${PARAM_NAMES.kwhPer100km}`,
      },
      numFmt: '0.00',
      comment: 'Energy delivered each session (formula)',
    },
    {
      name: PARAM_NAMES.slotsNeeded,
      value: {
        formula: `CEILING(${PARAM_NAMES.energyPerSessionKwh}/${PARAM_NAMES.chargePowerKw}/0.25,1)`,
      },
      numFmt: '0',
      comment: 'Quarter-hour slots required to charge one session (formula)',
    },
  ]

  rows.forEach((row, idx) => {
    const excelRow = idx + 2 // skip header
    const r = ws.getRow(excelRow)
    r.getCell(1).value = row.name
    if (typeof row.value === 'number') {
      r.getCell(2).value = row.value
    } else {
      r.getCell(2).value = { formula: row.value.formula }
    }
    if (row.numFmt) r.getCell(2).numFmt = row.numFmt
    if (row.comment) r.getCell(3).value = row.comment

    // Register defined name pointing at the value cell (column B) so formulas
    // on other sheets can reference it by name.
    workbook.definedNames.add(`parameters!$B$${excelRow}`, row.name)
  })

  return ws
}

/**
 * raw_prices sheet writer.
 *
 * Emits one row per non-projected QH price point with columns:
 *   A date | B month | C day | D qh | E hour | F minute | G ct_kWh
 *
 * The column layout is load-bearing: other builders reference these
 * letters in AVERAGEIFS / SUMPRODUCT formulas. If you reorder columns,
 * update every call site.
 *
 * NOTE: exceljs is intentionally only type-imported here — the runtime
 * import happens inside the builder entry points so it stays out of the
 * initial route bundle.
 */
import type { Workbook, Worksheet } from 'exceljs'
import type { HourlyPrice } from '@/lib/v2-config'

export function writeRawPricesSheet(
  workbook: Workbook,
  hourlyQH: HourlyPrice[],
): Worksheet {
  const ws = workbook.addWorksheet('raw_prices')
  ws.columns = [
    { header: 'date', key: 'date', width: 12 },
    { header: 'month', key: 'month', width: 7 },
    { header: 'day', key: 'day', width: 6 },
    { header: 'qh', key: 'qh', width: 6 },
    { header: 'hour', key: 'hour', width: 6 },
    { header: 'minute', key: 'minute', width: 8 },
    { header: 'ct_kWh', key: 'ctKwh', width: 10 },
  ]
  ws.getRow(1).font = { bold: true }
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  for (const p of hourlyQH) {
    if (p.isProjected) continue
    const month = Number(p.date.slice(5, 7))
    const day = Number(p.date.slice(8, 10))
    const qh = p.hour * 4 + Math.floor(p.minute / 15)
    const ctKwh = p.priceEurMwh / 10
    ws.addRow({
      date: p.date,
      month,
      day,
      qh,
      hour: p.hour,
      minute: p.minute,
      ctKwh: Math.round(ctKwh * 1000) / 1000,
    })
  }

  ws.getColumn('ctKwh').numFmt = '0.000'
  return ws
}

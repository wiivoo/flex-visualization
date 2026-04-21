export type GbDayAheadAuction = 'daa1' | 'daa2'

export const DEFAULT_GB_DAY_AHEAD_AUCTION: GbDayAheadAuction = 'daa1'

export const GB_DAY_AHEAD_OPTIONS: Array<{
  value: GbDayAheadAuction
  label: string
  shortLabel: string
  epexAuctionCode: 'GB' | '30-call-GB'
}> = [
  { value: 'daa1', label: "GB DAA 1 (60')", shortLabel: 'DAA 1', epexAuctionCode: 'GB' },
  { value: 'daa2', label: "GB DAA 2 (30')", shortLabel: 'DAA 2', epexAuctionCode: '30-call-GB' },
]

export function getGbDayAheadOption(value: GbDayAheadAuction) {
  return GB_DAY_AHEAD_OPTIONS.find(option => option.value === value) ?? GB_DAY_AHEAD_OPTIONS[0]
}

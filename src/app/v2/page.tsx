import { V2PageClient } from '@/components/v2/V2PageClient'
import { getEnableGb, getEnableIntraday } from '@/lib/country-config'

export const dynamic = 'force-dynamic'

export default function V2Page() {
  return <V2PageClient enableGb={getEnableGb()} enableIntraday={getEnableIntraday()} />
}

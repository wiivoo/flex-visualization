'use client'

import { Card, CardContent } from '@/components/ui/card'

/**
 * Visual primer for the battery page — explains the load-shift mechanism,
 * the dynamic-tariff assumption, the 800 W feed-in cap, and the no-export
 * constraint in one compact card at the top of the page.
 *
 * The left column is an inline SVG schematic: spot price wave, cheap/expensive
 * zones, charge/discharge markers, and a household demand baseline.
 */
export function BatteryIntroCard() {
  return (
    <Card className="shadow-sm border-gray-200/80 overflow-hidden">
      <CardContent className="p-4 md:p-5">
        <div className="flex flex-col md:flex-row gap-5 md:gap-6 items-start">
          {/* Schematic */}
          <div className="w-full md:w-[360px] flex-shrink-0">
            <svg
              viewBox="0 0 360 128"
              className="w-full h-auto block"
              aria-hidden
            >
              {/* Household demand baseline (gray area) */}
              <path
                d="M 0 108 C 30 104, 60 100, 90 102 C 130 105, 170 92, 210 86 C 250 82, 290 100, 330 104 L 360 106 L 360 128 L 0 128 Z"
                fill="#E5E7EB"
                fillOpacity="0.6"
              />
              {/* Cheap-zone fills (light blue) — valley regions */}
              <rect x="30" y="10" width="50" height="100" fill="#DBEAFE" fillOpacity="0.55" />
              <rect x="175" y="10" width="45" height="100" fill="#DBEAFE" fillOpacity="0.55" />
              {/* Expensive-zone fills (light green) — peak regions */}
              <rect x="100" y="10" width="45" height="100" fill="#D1FAE5" fillOpacity="0.55" />
              <rect x="240" y="10" width="50" height="100" fill="#D1FAE5" fillOpacity="0.55" />

              {/* Spot price line */}
              <path
                d="M 0 50 C 20 45, 40 75, 60 75 C 80 75, 100 20, 125 20 C 150 20, 165 62, 195 70 C 220 75, 240 30, 265 25 C 285 22, 310 58, 340 55 L 360 55"
                fill="none"
                stroke="#EA1C0A"
                strokeWidth="2"
                strokeOpacity="0.75"
              />

              {/* Charge markers (blue dots in cheap zones) */}
              <circle cx="55" cy="74" r="4" fill="#2563EB" />
              <circle cx="200" cy="69" r="4" fill="#2563EB" />
              {/* Charge arrows (down into battery area) */}
              <path d="M 55 78 L 55 96" stroke="#2563EB" strokeWidth="1.5" />
              <path d="M 51 93 L 55 97 L 59 93" stroke="#2563EB" strokeWidth="1.5" fill="none" />
              <path d="M 200 73 L 200 96" stroke="#2563EB" strokeWidth="1.5" />
              <path d="M 196 93 L 200 97 L 204 93" stroke="#2563EB" strokeWidth="1.5" fill="none" />

              {/* Discharge markers (green dots on peaks) */}
              <circle cx="125" cy="20" r="4" fill="#10B981" />
              <circle cx="265" cy="25" r="4" fill="#10B981" />
              {/* Discharge arrows (up, suggesting feeding household) */}
              <path d="M 125 96 L 125 26" stroke="#10B981" strokeWidth="1.5" strokeDasharray="3 2" />
              <path d="M 121 30 L 125 24 L 129 30" stroke="#10B981" strokeWidth="1.5" fill="none" />
              <path d="M 265 96 L 265 31" stroke="#10B981" strokeWidth="1.5" strokeDasharray="3 2" />
              <path d="M 261 35 L 265 29 L 269 35" stroke="#10B981" strokeWidth="1.5" fill="none" />

              {/* Zone labels */}
              <text x="55" y="9" fontSize="8" textAnchor="middle" fill="#2563EB" fontWeight="600">CHEAP</text>
              <text x="122" y="9" fontSize="8" textAnchor="middle" fill="#059669" fontWeight="600">PEAK</text>
              <text x="197" y="9" fontSize="8" textAnchor="middle" fill="#2563EB" fontWeight="600">CHEAP</text>
              <text x="265" y="9" fontSize="8" textAnchor="middle" fill="#059669" fontWeight="600">PEAK</text>

              {/* Legend inside chart */}
              <g transform="translate(4, 118)">
                <rect width="10" height="6" fill="#E5E7EB" />
                <text x="14" y="5.5" fontSize="7.5" fill="#6B7280">household load</text>
              </g>
              <g transform="translate(108, 118)">
                <rect width="10" height="6" fill="#EA1C0A" fillOpacity="0.75" />
                <text x="14" y="5.5" fontSize="7.5" fill="#6B7280">spot price</text>
              </g>
              <g transform="translate(188, 118)">
                <circle cx="5" cy="3" r="3" fill="#2563EB" />
                <text x="14" y="5.5" fontSize="7.5" fill="#6B7280">charge</text>
              </g>
              <g transform="translate(252, 118)">
                <circle cx="5" cy="3" r="3" fill="#10B981" />
                <text x="14" y="5.5" fontSize="7.5" fill="#6B7280">discharge</text>
              </g>
            </svg>
          </div>

          {/* Explanation + chips */}
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
              How this works
            </p>
            <h2 className="text-[14px] font-bold text-[#313131] leading-snug mb-2">
              Shift household load against the day-ahead spot curve.
            </h2>
            <p className="text-[12px] text-gray-600 leading-relaxed mb-3">
              The battery charges when the spot price is low and discharges when it is high, displacing
              what the household would otherwise draw from the grid at peak prices. Total consumption is
              unchanged — only <span className="font-semibold text-[#313131]">what the grid supplies</span> shifts.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200/80 rounded-full px-2 py-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                Dynamic tariff required
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-gray-50 text-gray-700 border border-gray-200 rounded-full px-2 py-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
                800 W feed-in cap
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200/80 rounded-full px-2 py-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                No export revenue — surplus is lost
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

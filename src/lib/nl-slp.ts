/**
 * Dutch E1A Standard Load Profile (Verbruiksprofiel)
 *
 * Source: NEDU/MFFBAS Standaardprofielen elektriciteit 2025 v1.00
 * Values are relative to daily average (1.0 = average hourly consumption).
 * Multiply by (yearlyKwh / 365 / 24) to get absolute kWh per hour.
 *
 * E1A = Standard Dutch household (enkeltarief, ≤ 3×25A connection)
 * Equivalent to Germany's H25 profile.
 */

export type NlDayType = 'weekday' | 'weekend'

const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const

// E1A profile: relative hourly weights (1.0 = daily average)
const E1A: Record<string, { weekday: number[]; weekend: number[] }> = {
  jan: {
    weekday: [0.8152, 0.7054, 0.6391, 0.6011, 0.5887, 0.6152, 0.7301, 0.9275, 1.0616, 1.0513, 0.8948, 0.7759, 0.7737, 0.7497, 0.7907, 0.9195, 1.2335, 1.7885, 1.7706, 1.6127, 1.4691, 1.3185, 1.1647, 1.003],
    weekend: [0.8219, 0.7053, 0.6332, 0.5949, 0.5786, 0.5889, 0.634, 0.7389, 0.9352, 1.0522, 0.9871, 0.8842, 0.8936, 0.8779, 0.929, 1.0495, 1.2884, 1.7384, 1.7399, 1.5711, 1.4211, 1.2622, 1.1184, 0.9563],
  },
  feb: {
    weekday: [0.9017, 0.7834, 0.717, 0.6871, 0.6757, 0.7123, 0.8513, 1.0776, 1.0789, 0.8926, 0.7002, 0.5936, 0.5837, 0.5561, 0.5791, 0.6697, 0.9611, 1.7355, 1.9325, 1.7892, 1.6339, 1.4729, 1.2992, 1.1157],
    weekend: [0.9052, 0.7823, 0.7063, 0.6694, 0.6564, 0.6629, 0.7201, 0.857, 1.0011, 0.9658, 0.8508, 0.7582, 0.7449, 0.7004, 0.7106, 0.7844, 1.0446, 1.684, 1.8656, 1.7061, 1.5484, 1.3848, 1.2322, 1.0584],
  },
  mar: {
    weekday: [1.0215, 0.8938, 0.8155, 0.7803, 0.777, 0.8334, 1.008, 1.0917, 0.8795, 0.6782, 0.5205, 0.4404, 0.4308, 0.4044, 0.4234, 0.498, 0.7911, 1.5275, 1.9395, 1.9822, 1.8524, 1.6763, 1.4728, 1.262],
    weekend: [1.0384, 0.9027, 0.8148, 0.7673, 0.7516, 0.7697, 0.8445, 0.901, 0.8514, 0.7667, 0.6636, 0.5838, 0.5814, 0.5375, 0.5325, 0.5904, 0.812, 1.4551, 1.8814, 1.904, 1.7881, 1.6208, 1.4324, 1.2089],
  },
  apr: {
    weekday: [1.2165, 1.0517, 0.9417, 0.888, 0.8802, 0.9197, 1.0725, 1.1128, 0.9279, 0.7304, 0.5576, 0.4458, 0.4332, 0.3838, 0.3615, 0.384, 0.5262, 1.0813, 1.356, 1.6091, 1.9332, 1.926, 1.7431, 1.5179],
    weekend: [1.2331, 1.0561, 0.9467, 0.8863, 0.8634, 0.8703, 0.9312, 0.8964, 0.8582, 0.7884, 0.666, 0.5601, 0.5503, 0.4885, 0.4594, 0.4746, 0.5907, 1.0555, 1.3548, 1.5691, 1.8902, 1.8698, 1.7011, 1.4399],
  },
  may: {
    weekday: [1.3884, 1.1845, 1.0482, 0.9796, 0.9586, 0.9687, 0.9131, 0.7924, 0.7112, 0.6066, 0.4817, 0.4114, 0.4223, 0.4059, 0.4044, 0.4106, 0.5476, 1.1069, 1.3353, 1.4728, 1.7809, 2.0083, 1.9481, 1.7124],
    weekend: [1.4276, 1.2135, 1.0749, 0.9925, 0.9672, 0.9519, 0.8094, 0.6402, 0.6817, 0.676, 0.588, 0.5104, 0.5221, 0.494, 0.4718, 0.4618, 0.5377, 0.9849, 1.2665, 1.4053, 1.754, 1.9898, 1.9136, 1.6651],
  },
  jun: {
    weekday: [1.5697, 1.342, 1.1999, 1.1189, 1.0779, 1.0414, 0.8272, 0.7316, 0.6518, 0.5362, 0.4106, 0.347, 0.3531, 0.3139, 0.3095, 0.3299, 0.4787, 0.9992, 1.2543, 1.3828, 1.6737, 2.0134, 2.1116, 1.9256],
    weekend: [1.5843, 1.3593, 1.1991, 1.1081, 1.0604, 1.0015, 0.7113, 0.5607, 0.6243, 0.623, 0.5272, 0.456, 0.4524, 0.4265, 0.41, 0.4235, 0.5271, 0.9432, 1.2062, 1.3555, 1.6359, 1.9592, 2.0271, 1.8182],
  },
  jul: {
    weekday: [1.5136, 1.2962, 1.164, 1.0879, 1.0487, 1.0399, 0.9098, 0.7508, 0.6667, 0.5708, 0.4642, 0.4016, 0.41, 0.3651, 0.3475, 0.3576, 0.489, 0.9989, 1.2279, 1.3538, 1.6647, 1.9918, 2.0362, 1.8433],
    weekend: [1.5443, 1.3348, 1.1868, 1.1036, 1.055, 1.0217, 0.8021, 0.5782, 0.6071, 0.6134, 0.5428, 0.4947, 0.5023, 0.4657, 0.4468, 0.4545, 0.5359, 0.9217, 1.1639, 1.2909, 1.6225, 1.9367, 1.9839, 1.7906],
  },
  aug: {
    weekday: [1.4062, 1.2045, 1.0836, 1.0136, 0.9863, 0.985, 1.0148, 0.8702, 0.722, 0.5996, 0.4607, 0.3927, 0.3894, 0.3532, 0.3339, 0.3489, 0.4759, 0.994, 1.2744, 1.512, 1.8903, 2.0339, 1.9346, 1.7203],
    weekend: [1.4076, 1.2143, 1.0817, 1.0101, 0.9637, 0.95, 0.9252, 0.759, 0.6892, 0.6609, 0.567, 0.5014, 0.508, 0.4783, 0.4579, 0.4534, 0.5329, 0.9249, 1.2251, 1.4574, 1.8351, 1.9371, 1.838, 1.6217],
  },
  sep: {
    weekday: [1.2173, 1.0435, 0.9391, 0.8796, 0.8533, 0.862, 0.9748, 1.1329, 0.8918, 0.647, 0.4649, 0.3668, 0.3563, 0.3285, 0.3267, 0.3662, 0.5591, 1.2091, 1.5764, 1.887, 2.0095, 1.8885, 1.7165, 1.5031],
    weekend: [1.2001, 1.0545, 0.9395, 0.8696, 0.8326, 0.8169, 0.8437, 0.924, 0.857, 0.7677, 0.6244, 0.5438, 0.5369, 0.4755, 0.4466, 0.459, 0.5824, 1.0887, 1.5169, 1.8445, 1.9577, 1.8016, 1.6191, 1.3973],
  },
  oct: {
    weekday: [0.9664, 0.8309, 0.7496, 0.7072, 0.6921, 0.7284, 0.8666, 1.1011, 1.0893, 0.839, 0.6277, 0.5255, 0.5161, 0.4869, 0.4981, 0.5849, 0.9014, 1.5918, 1.8856, 1.8794, 1.7434, 1.576, 1.4023, 1.2102],
    weekend: [1.0382, 0.8946, 0.7895, 0.7357, 0.7061, 0.7071, 0.7574, 0.9163, 1.0552, 0.9196, 0.7387, 0.6352, 0.6206, 0.56, 0.5331, 0.5869, 0.8054, 1.4504, 1.8738, 1.8787, 1.727, 1.5399, 1.3656, 1.165],
  },
  nov: {
    weekday: [0.8529, 0.733, 0.6644, 0.6277, 0.6114, 0.6401, 0.7744, 1.0008, 1.0335, 0.8601, 0.6828, 0.5916, 0.6163, 0.6345, 0.7262, 0.919, 1.3202, 1.9133, 1.8574, 1.6928, 1.5502, 1.3947, 1.236, 1.0669],
    weekend: [0.8426, 0.7321, 0.6573, 0.6133, 0.5877, 0.593, 0.649, 0.7876, 0.9509, 0.9277, 0.8448, 0.8028, 0.8423, 0.8628, 0.9294, 1.0674, 1.3572, 1.7883, 1.7422, 1.5758, 1.444, 1.2914, 1.1411, 0.9695],
  },
  dec: {
    weekday: [0.7958, 0.6865, 0.6192, 0.5851, 0.5691, 0.5939, 0.7046, 0.8893, 1.0367, 1.0448, 0.9106, 0.8216, 0.8308, 0.8254, 0.8985, 1.0561, 1.3271, 1.7376, 1.6908, 1.5537, 1.4256, 1.2903, 1.1334, 0.9732],
    weekend: [0.7893, 0.6785, 0.6075, 0.5693, 0.5518, 0.554, 0.6032, 0.7162, 0.9268, 1.0642, 1.0312, 1.0037, 1.0311, 1.0355, 1.0758, 1.1771, 1.3546, 1.6415, 1.61, 1.4585, 1.3403, 1.2047, 1.0619, 0.9135],
  },
}

/** Dutch public holidays (fixed + moveable) */
function getDutchHolidays(year: number): Set<string> {
  const pad = (n: number) => String(n).padStart(2, '0')
  const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

  // Easter (Anonymous Gregorian algorithm)
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1
  const day = ((h + l - 7 * m + 114) % 31) + 1
  const easter = new Date(Date.UTC(year, month, day))

  const offset = (days: number) => {
    const d2 = new Date(easter.getTime())
    d2.setUTCDate(d2.getUTCDate() + days)
    return fmt(d2)
  }

  return new Set([
    `${year}-01-01`,                // Nieuwjaarsdag
    `${year}-04-27`,                // Koningsdag
    `${year}-05-05`,                // Bevrijdingsdag
    `${year}-12-25`,                // Eerste Kerstdag
    `${year}-12-26`,                // Tweede Kerstdag
    offset(-2),                     // Goede Vrijdag
    offset(0),                      // Eerste Paasdag
    offset(1),                      // Tweede Paasdag
    offset(39),                     // Hemelvaartsdag
    offset(49),                     // Eerste Pinksterdag
    offset(50),                     // Tweede Pinksterdag
  ])
}

/** Classify a date as weekday or weekend/holiday */
export function getNlDayType(dateStr: string): NlDayType {
  const d = new Date(dateStr + 'T12:00:00Z')
  const dow = d.getUTCDay()
  if (dow === 0 || dow === 6) return 'weekend'
  const year = d.getUTCFullYear()
  if (getDutchHolidays(year).has(dateStr)) return 'weekend'
  return 'weekday'
}

/**
 * Get E1A hourly consumption weights for a given month and day type.
 * Returns 24 values (one per hour), relative to daily average.
 * Multiply by (yearlyKwh / 365 / 24) to get kWh per hour.
 */
export function getNlHourlyWeights(month: number, dayType: NlDayType): number[] {
  const key = MONTH_KEYS[month - 1]
  if (!key) return Array(24).fill(1)
  return E1A[key][dayType]
}

/**
 * Get E1A quarter-hourly consumption weights (interpolated from hourly).
 * Returns 96 values. Each QH slot gets the parent hour's weight.
 */
export function getNlQHWeights(month: number, dayType: NlDayType): number[] {
  const hourly = getNlHourlyWeights(month, dayType)
  const qh: number[] = []
  for (const w of hourly) {
    qh.push(w, w, w, w)
  }
  return qh
}

/** Yearly normalization factor: sum of all daily weights across the year */
export function getNlYearlyWeightSum(year: number): number {
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const daysInYear = isLeap ? 366 : 365
  let total = 0
  const start = new Date(Date.UTC(year, 0, 1))
  for (let d = 0; d < daysInYear; d++) {
    const date = new Date(start.getTime() + d * 86400000)
    const month = date.getUTCMonth() + 1
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
    const dayType = getNlDayType(dateStr)
    const weights = getNlHourlyWeights(month, dayType)
    total += weights.reduce((s, w) => s + w, 0)
  }
  return total
}

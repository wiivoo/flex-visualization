import { readFileSync } from 'fs';

const raw = JSON.parse(readFileSync('/Users/lars/claude/projects/mmm/public/data/smard-prices.json', 'utf8'));

// Convert to hourly records with ct/kWh
const hours = raw.map(r => {
  const d = new Date(r.t);
  return {
    ts: r.t,
    date: d.toISOString().slice(0, 10),
    hour: d.getUTCHours(),
    dow: d.getUTCDay(), // 0=Sun, 5=Fri
    price: r.p / 10, // ct/kWh
  };
});

// Index by timestamp for quick lookup
const byTs = new Map(hours.map(h => [h.ts, h]));

// Find all Fridays at 18:00
const fridayStarts = hours.filter(h => h.dow === 5 && h.hour === 18);

function cheapest3h(prices) {
  if (prices.length < 3) return { avg: null, hours: [] };
  let bestSum = Infinity;
  let bestIdx = 0;
  for (let i = 0; i <= prices.length - 3; i++) {
    const sum = prices[i].price + prices[i+1].price + prices[i+2].price;
    if (sum < bestSum) {
      bestSum = sum;
      bestIdx = i;
    }
  }
  return {
    avg: bestSum / 3,
    hours: prices.slice(bestIdx, bestIdx + 3),
  };
}

function getSpread(prices) {
  if (prices.length === 0) return 0;
  const vals = prices.map(p => p.price);
  return Math.max(...vals) - Math.min(...vals);
}

function getWindow(startTs, durationHours) {
  const prices = [];
  for (let i = 0; i < durationHours; i++) {
    const ts = startTs + i * 3600000;
    const h = byTs.get(ts);
    if (h) prices.push(h);
  }
  return prices;
}

const results = [];

for (const fri of fridayStarts) {
  const t0 = fri.ts;
  
  const overnightPrices = getWindow(t0, 13);  // Fri 18 -> Sat 07 (13h)
  const day24Prices     = getWindow(t0, 24);  // Fri 18 -> Sat 18 (24h)
  const weekendPrices   = getWindow(t0, 53);  // Fri 18 -> Sun 23 (53h)
  const weeklyPrices    = getWindow(t0, 168); // 7 days
  const baselinePrices  = getWindow(t0, 3);   // Fri 18-20
  
  if (baselinePrices.length < 3) continue;
  if (overnightPrices.length < 13) continue;
  if (day24Prices.length < 24) continue;
  if (weekendPrices.length < 50) continue;
  
  const baseline   = baselinePrices.reduce((s,h) => s + h.price, 0) / 3;
  const overnight  = cheapest3h(overnightPrices);
  const day24      = cheapest3h(day24Prices);
  const weekend    = cheapest3h(weekendPrices);
  const weekly     = cheapest3h(weeklyPrices);
  
  if (!overnight.avg || !day24.avg || !weekend.avg) continue;
  
  const score = baseline - weekend.avg;
  
  const monotonic = overnight.avg >= day24.avg - 0.001 
                 && day24.avg >= weekend.avg - 0.001;
  
  results.push({
    date: fri.date,
    baseline,
    overnightAvg: overnight.avg,
    day24Avg: day24.avg,
    weekendAvg: weekend.avg,
    weeklyAvg: weekly?.avg,
    overnightSpread: getSpread(overnightPrices),
    day24Spread: getSpread(day24Prices),
    weekendSpread: getSpread(weekendPrices),
    weeklySpread: weekly ? getSpread(weeklyPrices) : null,
    score,
    monotonic,
  });
}

results.sort((a, b) => b.score - a.score);

console.log('\n=== TOP 10 FRIDAYS: "Longer plug-in = more savings" ===\n');
console.log('Rank | Date       | Baseline | Overnight | 24h Opt | Weekend | Weekly  | Score  | Mono | Spreads (O/24/W/Wk)');
console.log('-----|------------|----------|-----------|---------|---------|---------|--------|------|--------------------');

for (let i = 0; i < Math.min(10, results.length); i++) {
  const r = results[i];
  const fmt = v => v != null ? v.toFixed(2).padStart(6) : '  N/A ';
  const fmtS = v => v != null ? v.toFixed(1).padStart(5) : ' N/A ';
  console.log(
    `  ${String(i+1).padStart(2)} | ${r.date} | ${fmt(r.baseline)} | ${fmt(r.overnightAvg)}    | ${fmt(r.day24Avg)}  | ${fmt(r.weekendAvg)}  | ${fmt(r.weeklyAvg)}  | ${fmt(r.score)} | ${r.monotonic ? ' yes' : '  NO'} | ${fmtS(r.overnightSpread)}/${fmtS(r.day24Spread)}/${fmtS(r.weekendSpread)}/${fmtS(r.weeklySpread)}`
  );
}

console.log('\n--- Detail for #1 ---');
const top = results[0];
if (top) {
  console.log(`Date: ${top.date}`);
  console.log(`Baseline (Fri 18-20): ${top.baseline.toFixed(2)} ct/kWh`);
  console.log(`Best overnight 3h avg: ${top.overnightAvg.toFixed(2)} ct/kWh  (saving ${(top.baseline - top.overnightAvg).toFixed(2)} ct/kWh)`);
  console.log(`Best 24h 3h avg:       ${top.day24Avg.toFixed(2)} ct/kWh  (saving ${(top.baseline - top.day24Avg).toFixed(2)} ct/kWh)`);
  console.log(`Best weekend 3h avg:   ${top.weekendAvg.toFixed(2)} ct/kWh  (saving ${(top.baseline - top.weekendAvg).toFixed(2)} ct/kWh)`);
  console.log(`Best weekly 3h avg:    ${top.weeklyAvg?.toFixed(2)} ct/kWh  (saving ${top.weeklyAvg ? (top.baseline - top.weeklyAvg).toFixed(2) : 'N/A'} ct/kWh)`);
  console.log(`Weekend spread: ${top.weekendSpread.toFixed(2)} ct/kWh`);
}

const monoCount = results.filter(r => r.monotonic).length;
console.log(`\nMonotonic Fridays: ${monoCount} / ${results.length} (${(monoCount/results.length*100).toFixed(1)}%)`);

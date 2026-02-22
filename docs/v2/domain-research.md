# Domain Research: B2C Flexibility Monetization via Smart EV Charging

## 1. Day-Ahead Load Shifting

### Mechanism
The BKV (Bilanzkreisverantwortlicher) procures energy on the EPEX Spot day-ahead auction at 12:00 CET for the following day. With controllable EV charging, procurement shifts from expensive peak hours (17:00–20:00) to cheap hours (02:00–06:00 or midday solar surplus).

### Market Data (EPEX Spot Germany)

**2024:**
- Baseload average: 79.6 EUR/MWh (7.96 ct/kWh)
- Peak load average: 88.2 EUR/MWh (8.82 ct/kWh)
- Off-peak average: 74.8 EUR/MWh (7.48 ct/kWh)
- Average daily spread (max−min): 117.4 EUR/MWh
- Negative price hours: 459 (5.2% of year)

**2025 (Jan–mid year):**
- Baseload average: 89.3 EUR/MWh (+16% vs 2024)
- Peak average: 92.3 EUR/MWh
- Average daily spread: 130.4 EUR/MWh (three-year high)
- Negative price hours: ~575 (significantly up)
- Maximum: 583 EUR/MWh (Jan 20)
- Minimum: −250 EUR/MWh (May 11)

### Steering Value Calculation
```
Net Steering Value = Σ(baseline_price[h] × kWh[h]) − Σ(optimized_price[h] × kWh[h])
```
Where:
- `baseline_price[h]` = price during "charge immediately" hours
- `optimized_price[h]` = price during cheapest available hours
- `kWh[h]` = energy charged per hour interval

### Realistic per-session value
- Average session: ~20 kWh
- Peak-to-offpeak shift: 13 EUR/MWh × 0.02 MWh = 0.26 EUR (minimum)
- Extreme day: 200 EUR/MWh spread × 0.02 MWh = 4.00 EUR (high)
- Realistic average: 2–5 ct/kWh or 0.40–1.00 EUR per session

## 2. Forward Purchasing Advantage

### Mechanism
The BKV buys on EEX futures market (year-ahead, quarter-ahead). Key products:
- **Baseload**: Flat delivery 24/7
- **Peakload**: Mon–Fri 08:00–20:00

Without flexible loads → need expensive peakload (evening EV charging).
With flexible loads → buy cheaper baseload, shift consumption to match.

### Spreads
- 2024 peak-base spread: 8.6 EUR/MWh
- 2025 peak-base spread: 3.0 EUR/MWh (compressed by solar expansion)
- Historical average: 10–15 EUR/MWh

### Value
At 8.6 EUR/MWh spread × 4 MWh/year = **34.40 EUR/year per EV**

## 3. Portfolio Optimization

### The Portfolio Effect
- 1 EV = unpredictable load
- 1,000 EVs = ~95% predictable (law of large numbers)
- 10,000 EVs = forecast error drops from ±30% (individual) to ±3–5% (aggregate)

### Balancing Energy Savings
- reBAP (uniform balancing price) averaged 1.7 EUR/MWh above spot in Q1 2024
- Historical: 35 EUR/MWh (2019–20), 100 EUR/MWh (2021), 158 EUR/MWh (early 2022)
- BCG estimate: EV-related costs reduced by **>70%** through smart aggregation

### Value: 20–50 EUR/year per EV

## 4. Intraday Re-Optimization

### Mechanism
After day-ahead procurement, the BKV re-optimizes on:
- EPEX Spot Intraday Auction (15-min products)
- EPEX Spot Intraday Continuous (up to 5 min before delivery)

### Market Data
- Max intraday continuous price 2025: 1,056 EUR/MWh (Jan 7)
- 2,350 negative quarter-hourly instances in 2024
- Spreads typically larger than day-ahead (forecast updates)

### Value: 10–30 EUR/year per EV

## 5. §14a EnWG — Grid Fee Reduction

### Regulatory Framework
Since Jan 1, 2024: All new wallboxes >4.2 kW must register as steuerbare Verbrauchseinrichtung. Grid operator can curtail to minimum 4.2 kW in exchange for fee reduction.

### Compensation Modules

| Module | Mechanism | Annual Savings |
|---|---|---|
| Modul 1 | Flat-rate grid fee reduction | 110–190 EUR (~165 avg) |
| Modul 2 | 60% reduction on grid work price + no basic fee | 80–200 EUR |
| Modul 3 | Time-variable grid fees (HT/NT/ST) | Additional on top of Modul 1 |

### Strategic Role
- §14a is the **customer acquisition hook** — guaranteed, tangible savings
- The BKV passes grid fee savings to customer while keeping trading margin

## 6. Competitive Landscape

### 1KOMMA5° (Heartbeat AI)
- 500 MW virtual power plant (Europe's largest)
- Spun off Heartbeat AI for intraday optimization
- Case study: 4.76 ct/kWh net grid charging vs. 40.92 ct/kWh national average
- Full system (PV + battery + wallbox + heat pump): 2,201 EUR/year savings

### Tibber
- Claims 10–35% savings via dynamic pricing
- Smart charging shifts to cheapest hours automatically

### Octopus Energy
- Intelligent Go: 7.5 p/kWh (~9 ct/kWh) smart charging vs. 24 p/kWh standard
- Annual savings: 400–600 GBP (470–700 EUR)

### Market Opportunity
- BCG: 58 billion EUR/year unmonetized flexibility across Europe
- Only <20% of ~100 GW flexibility capacity currently monetized
- Smart meter rollout accelerating (mandatory dynamic tariffs since Jan 2025)

## 7. Key Trends

1. **Volatility is structural** — more renewables = more price swings = more optimization value
2. **15-minute market transition (Oct 2025)** — quarter-hourly day-ahead products create more granularity
3. **Negative prices increasing** — 459h (2024) → 575h (2025) → trend continues
4. **Aggregation is the moat** — single EV = commodity; portfolio of 100k EVs = significant market power

## Sources
- FfE: EPEX Spot Price Analysis 2024/2025
- BCG Platinion: Powering Up Flexible Energy
- Simon-Kucher: V2G Monetarisierung
- gridX: Flexibility Value Stacking / Time-Variable Grid Fees
- 1KOMMA5°: Heartbeat AI / Case Studies
- Bundesnetzagentur: Steuerbare Verbrauchseinrichtungen
- Next Kraftwerke: Intraday Handel / Ausgleichsenergie
- EEX: Power Futures Market Data
- SMARD: Market Data Evaluation 2024/2025

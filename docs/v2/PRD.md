# Product Requirements Document — FlexMon v2: B2C Flexibility Monetization Explainer

## Vision

An interactive, storytelling-driven tool that explains to top management how an energy company (E.ON) monetizes B2C flexibility through smart EV charging. The tool walks the viewer through the value chain step by step — from raw price data to the full revenue waterfall — using real market data, intuitive visualizations, and interactive controls.

**One-sentence pitch:** "We buy electricity when it's cheap and charge cars when nobody else does — here's how much that's worth."

## Target Users

- **Primary:** CEO/CFO/Board level at E.ON (non-technical, need the story, not the math)
- **Secondary:** Product managers and sales leads who present the business case internally

## Design Philosophy

- **Storytelling over dashboarding** — multi-step guided flow, not a traditional data grid
- **Evolving complexity** — starts simple ("here's what a price curve looks like"), builds to the full value waterfall
- **Real data, real credibility** — 3 years of SMARD/aWATTar day-ahead prices, interactive calendar
- **Interactive "what-if"** — drag sliders, change assumptions, see impact live
- **Every number explained** — the ~430 EUR/year value is broken down interactively, not just stated
- **E.ON branded** — corporate design system, presentation-ready

## Core Concept: The Value Chain

### Layer 1: Day-Ahead Load Shifting (interactive core)
The customer plugs in at 18:00, needs the car at 07:00. Without flexibility, charging starts immediately at peak prices. With flexibility, charging shifts to the cheapest hours overnight.

**Net Steering Value** = Cost(baseline charging) - Cost(optimized charging)

This is the centerpiece: an interactive graph where the user adjusts plug-in time, battery level, and vehicle — and sees the value change live.

### Layer 2: Forward Purchasing Advantage
With flexible loads, the BKV buys cheaper baseload futures instead of expensive peakload products. Peak-base spread on EEX: ~8-15 EUR/MWh historically.

### Layer 3: Intraday Re-Optimization
After day-ahead procurement, re-optimize on EPEX Spot intraday (continuous + auction). Captures additional value from forecast changes (wind/solar updates).

### Layer 4: Portfolio Optimization
Aggregating thousands of EVs makes load predictable (law of large numbers). Reduces balancing energy costs by >70% (BCG estimate).

### Layer 5: Grid Fee Reduction (customer hook)
Wallboxes registered as steuerbare Verbrauchseinrichtung (§14a EnWG) get reduced grid fees. ~165 EUR/year guaranteed savings → customer acquisition tool.

## Realistic Value per EV per Year

| Revenue Stream | Conservative | Realistic | Optimistic |
|---|---|---|---|
| Day-ahead load shifting | 50 EUR | 150 EUR | 300 EUR |
| Forward purchasing | 30 EUR | 50 EUR | 80 EUR |
| Intraday re-optimization | 10 EUR | 25 EUR | 50 EUR |
| Portfolio effect (balancing) | 20 EUR | 40 EUR | 60 EUR |
| Grid fee reduction (§14a) | 110 EUR | 165 EUR | 190 EUR |
| **Total** | **220 EUR** | **430 EUR** | **680 EUR** |

### Value Split

| Party | Gets |
|---|---|
| Customer | Grid fee reduction (165 EUR) + lower charging tariff (50-100 EUR) = ~215-265 EUR |
| E.ON (BKV) | Day-ahead arbitrage + forward/intraday/balancing margin = ~110-390 EUR |

## Competitor Benchmarks

| Competitor | Product | Published Savings | Key Metric |
|---|---|---|---|
| **Octopus Energy DE** | Intelligent Octopus Go | Up to 450 EUR/year | Max. 20 ct/kWh smart window, EUR 4/100km vs. EUR 14 petrol |
| **The Mobility House** | V2G EPEX Spot Trading | 650+ EUR/year (net, after tax) | "Four-digit gross" from Berlin field trial (2022) |
| **The Mobility House** | THG Quota | 80-200 EUR/year (2026) | Declining from 300 EUR peak in 2022 |
| **Jedlix (Shell)** | B2B2C Smart Charging | ~3.5 ct/kWh savings | ~15% bill reduction (Netherlands proxy) |
| **Sonnen** | VPP + §14a | ~250 EUR/year | 100 EUR VPP + 150 EUR grid incentive |
| **1KOMMA5** | Heartbeat AI (full system) | 2,201 EUR/year | PV + battery + wallbox + heat pump combined |

**Our position:** E.ON's 430 EUR/year per EV (realistic) is competitive with Octopus (450 EUR) and above Sonnen (250 EUR), while The Mobility House's 650+ EUR requires bidirectional hardware we don't need.

## User Flow (5-Step Guided Presentation)

### Step 1: "The Price Curve" — Understanding Volatility
- Real SMARD day-ahead prices with interactive 3-year calendar
- Show how prices swing hour by hour
- Highlight seasonal patterns: summer midday dips (solar), winter evening peaks
- KPIs: daily spread, negative price hours, average price

### Step 2: "The Charging Scenario" — Interactive Load Shifting
- Configure EV: plug-in time, departure, vehicle, battery level
- **Core graph:** Price curve with baseline vs. optimized charging overlaid
- Shaded area = net steering value (the money)
- Live-updating cost comparison
- This is the graph that makes the concept click

### Step 3: "The Value Waterfall" — Breaking Down 430 EUR/year
- Interactive waterfall chart building up all 5 revenue layers
- Day-ahead bar driven by live data from Step 2
- Each layer expandable with plain-language explanation
- Split view: customer benefit vs. E.ON margin
- Competitor comparison sidebar

### Step 4: "The Portfolio Scale" — From 1 to 100,000 EVs
- Logarithmic slider showing revenue at scale
- Portfolio effect: forecasting accuracy improves with sqrt(N)
- Key milestones: 10k EVs = market access, 50k = virtual power plant
- Annual revenue in millions

### Step 5: "The Market Context" — Why Now?
- 3-year volatility trend (increasing — structural)
- Seasonal patterns: when is the opportunity biggest?
- Negative price hours growing year over year
- Regulatory tailwinds: dynamic tariffs mandatory, §14a, smart meter rollout
- Competitive landscape with benchmarks

## Data Sources

### Primary: aWATTar API
- Endpoint: `https://api.awattar.de/v1/marketdata?start={ms}&end={ms}`
- Hourly EPEX Spot day-ahead prices, EUR/MWh
- No authentication, no rate limits
- Historical data back to 2017+
- Simpler than SMARD: direct date range queries

### Secondary: SMARD API
- Endpoint: `chart_data/4169/DE/4169_DE_hour_{TIMESTAMP}.json`
- Weekly chunks, ~157 files for 3 years
- Parallel fetch <1s with 20 workers
- Used as fallback if aWATTar is unavailable

### Caching
- Supabase: hourly prices table for fast queries
- Bulk load 3 years on first deploy
- Daily update for current prices

## Technical Stack

- Next.js 16 + TypeScript (App Router)
- Recharts for visualizations
- shadcn/ui + Tailwind CSS
- Supabase (price cache + auth)
- E.ON design (Inter font, red/dark/blue palette)
- Desktop-optimized (1440px)
- Password-protected (JWT)

## Success Criteria

1. A non-technical executive understands the full flexibility value chain in <5 minutes
2. The interactive charging graph makes the day-ahead value tangible and intuitive
3. The 430 EUR/year is not just stated but interactively broken down and explained
4. Volatility seasonality is clear: viewer understands when the opportunity is biggest
5. Competitor benchmarks provide market context and credibility
6. Real SMARD/aWATTar data — not simulated numbers
7. Presentation-ready: projector in a board meeting

## Non-Goals

- No live trading integration
- No individual user accounts (password-only)
- No mobile optimization (desktop presentation tool)
- No integration with real charging infrastructure
- No multi-language (English UI)

# PROJ-18: Mini Calendar (Date Picker)

## Status: Deployed
**Location:** `src/components/v2/steps/Step2ChargingScenario.tsx` (lines 67–178)

## Description

Month-view calendar widget in the sidebar for selecting the day to visualize. Each day shows a colored bar indicating the day's price spread (max − min EUR/MWh).

## Features

- Month navigation with back/forward buttons, constrained to data range
- Spread color scale: green (low) → yellow (medium) → red (high >200 EUR/MWh)
- Days without next-day data are disabled (needed for overnight chart spanning two days)
- "Latest" button jumps to most recent available date
- Below calendar: overnight spread (plug-in price vs cheapest window slot) and full day spread (24h high vs low)

## Spread Stats (Sidebar)

- **Overnight Spread**: arrival-hour price minus cheapest slot in charging window (ct/kWh)
- **Full Day Spread**: 24h max minus min (theoretical maximum arbitrage)
- Both include exact hour labels and tooltip explanations

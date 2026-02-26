# PROJ-17: Customer Profile Configurator

**Status:** Deployed
**Location:** `src/components/v2/steps/Step2ChargingScenario.tsx` (lines 770–900)

## Description

Interactive customer profiling panel with four configurable parameters that drive all downstream calculations (chart, savings, heatmap).

## Controls

| Parameter | Range | Default | UI |
|-----------|-------|---------|-----|
| Yearly Mileage | 5,000–40,000 km | 15,000 | Slider + BEV mileage distribution bars (KBA 2024) |
| Weekly Plug-ins | 1–7x/week | 4 | Slider + visual frequency indicator |
| Plug-in Time | 14:00–22:00 (overnight) / 0:00–23:00 (full day) | 18:00 | Slider + German EV arrival distribution bars |
| Per Session (derived) | — | — | Read-only: kWh, km range, sessions/yr |

## Key Logic

- Energy per session = `(yearlyMileageKm / (weeklyPlugIns * 52)) / 100 * 19 kWh/100km`
- Session duration = `energyPerSession / 7 kW`
- Flexibility hours = window hours − charging hours needed

## Data Sources

- BEV mileage distribution: KBA 2024 (6 bins, 5k–40k km)
- Plug-in time distribution: BDEW smart-meter load profiles (peak 17–18h, 21–27%)
- Consumption: 19 kWh/100km average
- Wallbox power: 7 kW fixed

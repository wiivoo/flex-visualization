# PROJ-17: Customer Profile Configurator

**Status:** Deployed
**Location:** `src/components/v2/steps/Step2ChargingScenario.tsx` (lines ~640–805)

## Description

Interactive customer profiling panel with four columns of configurable parameters that drive all downstream calculations (chart, savings, heatmap, fleet).

## Controls

| Parameter | Range | Default | UI |
|-----------|-------|---------|-----|
| Yearly Mileage | 5,000–40,000 km | 15,000 | Slider + BEV mileage distribution bars (KBA 2024) |
| Weekday Plug-ins (Mon–Fri) | 0–5x | 3 | Slider + day block visual |
| Weekend Plug-ins (Sat–Sun) | 0–2x | 1 | Slider (gray track/thumb) + day block visual |
| Plug-in Time | 14:00–22:00 (overnight) / 0:00–23:00 (full day) | 18:00 | Slider + German EV arrival distribution bars |
| Per Session (derived) | — | — | Read-only: kWh, km range, sessions/yr |
| Wallbox Power | 7 kW / 11 kW | 7 | Toggle pill in Weekly Plug-ins column |

## Layout

Four-column grid (`grid-cols-2 md:grid-cols-4`) with consistent vertical rhythm:
- Each column uses `flex flex-col gap-2` with a fixed `h-8` header row
- Headers: uppercase label left, large value right
- All sliders use the same thumb/track styling (dark `#313131` thumb, gray track)

## Weekday/Weekend Split

The Weekly Plug-ins column has two sub-sliders:
- **Mon–Fri** (0–5): dark track, dark thumb, `text-gray-500` label
- **Sat–Sun** (0–2): gray-300 track, gray-500 thumb, `text-gray-400` label
- **Day blocks**: 5 weekday + 2 weekend blocks with separator, filled/empty based on slider values
- **Total**: shown in header as `Nx / wk`

## Wallbox Toggle

A pill-style toggle button (matching the fleet mileage distribution toggle) that cycles between 7 kW and 11 kW. Located inline in the Weekly Plug-ins column footer text: `~X.X kWh/session · [7 kW]`.

## Key Logic

- Energy per session = `(yearlyMileageKm / ((weekdayPlugIns + weekendPlugIns) * 52)) / 100 * 19 kWh/100km`
- Minimum 1 weekly plug-in for computation (guards against division by zero)
- Session duration = `energyPerSession / chargePowerKw`
- Flexibility hours = window hours − charging hours needed

## Data Sources

- BEV mileage distribution: KBA 2024 (6 bins, 5k–40k km)
- Plug-in time distribution: BDEW smart-meter load profiles (peak 17–18h, 21–27%)
- Consumption: 19 kWh/100km average
- Wallbox power: 7 kW or 11 kW (user toggle)

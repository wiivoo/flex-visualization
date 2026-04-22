# PROJ-19: Session Cost Breakdown

## Status: Deployed
**Location:** `src/components/v2/steps/Step2ChargingScenario.tsx` (lines 1440–1539)

## Description

Side-by-side comparison table showing the hour-by-hour cost of a single charging session under immediate (unmanaged) vs optimized scheduling.

## Layout

Two columns:
- **Left (red)**: Unmanaged — first N time slots chronologically from plug-in
- **Right (green)**: Optimized — cheapest N time slots in window

Each column shows:
- Individual slot prices (HH:MM → ct/kWh)
- Average price at bottom

## Collapsible Formula Section

Shows the arithmetic: `avg ct × kWh ÷ 100 = EUR` for both strategies, with the delta displayed as savings in ct/kWh and EUR.

## Context Line

Summarizes: sessions/yr, kWh/session, charge duration, window size, flexibility hours (color-coded: green >3h, amber >0h, red 0h).

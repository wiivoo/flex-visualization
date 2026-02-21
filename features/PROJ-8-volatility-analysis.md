# PROJ-8: Volatilitäts-Analyse & Spread-Dashboard

## Status: In Review
**Created:** 2026-02-22
**Last Updated:** 2026-02-22

## Dependencies
- Requires: PROJ-1 (SMARD Datenintegration) - für Preisdaten

## User Stories
- Als CEO möchte ich auf einen Blick sehen, wie groß das tägliche Arbitrage-Potenzial ist
- Als Analyst möchte ich Tage mit hoher Volatilität identifizieren für Kundenpräsentationen
- Als Decision Maker möchte ich verstehen, wie oft sich flexibles Laden wirklich lohnt

## Acceptance Criteria
- [x] Volatilitäts-Analyse Section im Dashboard sichtbar (bei Multi-Tag-Daten)
- [x] KPIs: Ø Täglicher Spread, Max. Spread, Arbitrage-Tage, Analysierte Tage
- [x] Spread-Bandbreiten-Chart: Min-Max-Band pro Tag mit Durchschnittslinie
- [x] Spread-Barometer: Tägliche Spreads als farbcodierte Balken
- [x] Farbcodierung: Grün (>20ct), Gelb (10-20ct), Grau (<10ct)
- [x] Deutsche Beschriftung und Locale
- [x] Tooltips mit Details (Datum, Min, Max, Spread, Bewertung)
- [x] Legende erklärt Farbskala

## Technical Requirements
- **Performance:** Chart render < 200ms (useMemo für Aggregation)
- **Data:** Nutzt bestehende PricePoint[] Daten, keine zusätzlichen API-Calls
- **Responsive:** Charts mit ResponsiveContainer

## Files
- `src/components/dashboard/VolatilityAnalysis.tsx` - Hauptkomponente
- `src/app/page.tsx` - Integration (Import + Rendering)

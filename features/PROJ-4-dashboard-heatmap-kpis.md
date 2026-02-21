# PROJ-4: Dashboard UI - Heatmap & KPIs

## Status: Planned
**Created:** 2025-02-21
**Last Updated:** 2025-02-21

## Dependencies
- Requires: PROJ-1 (SMARD Datenintegration) - für Preisdaten
- Requires: PROJ-2 (Preis-Optimierungsalgorithmus) - für Optimierungsergebnisse

## User Stories
- Als Produkt-Manager möchte ich verschiedene Autotypen vergleichen können
- Als CEO möchte ich KPIs auf einen Blick sehen (Gewinn, Ersparnis)
- Als Sales-Mitarbeiter möchte ich Heatmaps für Kundenpräsentationen nutzen

## Acceptance Criteria

### KPI-Karten (oben)
- [ ] 3-4 große KPI-Karten über dem Chart
- [ ] KPI 1: **Ersparnis pro Ladung** (z.B. "€ 18,40")
- [ ] KPI 2: **Unsere Marge pro Monat** (z.B. "€ 552 / Auto")
- [ ] KPI 3: **Kunden-Vorteil** (z.B. "€ 8,40 / Ladung")
- [ ] KPI 4: **Beste Zeit zum Laden** (z.B. "02:00 - 05:30 Uhr")
- [ ] Jede KPI hat Icon, Label, Wert, und kleiner delta-Hinweis

### Heatmap (unten)
- [ ] Heatmap: Y-Achse = Autotypen, X-Achse = Uhrzeit (00:00-24:00)
- [ ] Farben = Gewinnpotential (Grün = günstig, Rot = teuer)
- [ ] 3 Autotypen: Kleinwagen (40kWh), Mittelklasse (60kWh), SUV (100kWh)
- [ ] Tooltip auf Hover: Autotyp + Uhrzeit + Gewinn
- [ ] Legende erklärt Farbskala

### Vorher-Nachher Vergleich
- [ ] Side-by-side KPI oder Toggle
- [ ] Links: "Ohne Flex" - teurer Laden (z.B. € 21,00)
- [ ] Rechts: "Mit Flex" - günstigeres Laden (z.B. € 2,64)
- [ ] Differenz hervorgehoben (z.B. "-€ 18,36" in Grün)

## UI Spec

**KPI Layout:**
```
┌─────────────┬─────────────┬─────────────┬─────────────┐
│  💰 Ersparnis│  📈 Marge/M │  🎁 Kunde   │  ⏰ Beste Zt│
│     € 18.40 │     € 552   │     € 8.40  │  02:00-05:30│
│    pro Ladung│    pro Auto│   pro Ladung│             │
└─────────────┴─────────────┴─────────────┴─────────────┘
```

**Heatmap Layout:**
```
┌─────────────────────────────────────────────────────┐
│           Gewinnpotenzial nach Autotyp               │
│                                                     │
│  SUV (100kWh)  ░░▒▒▒▒███░░░░░░░░░░░░░▒▒▒▒▒░░░░░░░░  │
│  Mittel (60kWh)░░▒▒▒███░░░░░░░░░░░░░░▒▒▒▒░░░░░░░░░  │
│  Klein (40kWh) ░░▒▒███░░░░░░░░░░░░░░▒▒▒░░░░░░░░░░  │
│                ────────────────────────────────     │
│               00  06  12  18  24                    │
│                                                     │
│  ░░ Negativ   ▒▒ Gering    ███ Hoch                │
└─────────────────────────────────────────────────────┘
```

## Edge Cases
- **Was bei negativem Gewinn?** → Rote KPI mit "(-) " Präfix
- **Was wenn kein Autotyp gewählt?** → Zeige Mittelklasse als Default
- **Was bei sehr kleinen Werten?** → "€ 0,50" nicht "€ 0,5" (2 Dezimalen)
- **Was wenn alle Werte gleich?** → Heatmap zeigt einfarbig, Hinweis "Keine Varianz"

## Technical Requirements
- **Performance:** KPIs < 50ms render, Heatmap < 100ms
- **Color Scale:** Kontinuierlich von Rot (-€) über Gelb (0€) zu Grün (+€)
- **Export:** KPIs können als Text kopiert werden

## Visual Design
- **KPI Karten:** Weißer Hintergrund, subtiler Schatten, abgerundet
- **Zahlen:** Bold, 32px für Hauptwert, 14px für Label
- **Farben:**
  - Positiv: Grün `#22c55e`
  - Negativ: Rot `#ef4444`
  - Neutral: Grau `#6b7280`

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_

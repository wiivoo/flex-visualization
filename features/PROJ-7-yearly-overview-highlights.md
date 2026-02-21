# PROJ-7: Jahresansicht & Highlights

## Status: Planned
**Created:** 2025-02-21
**Last Updated:** 2025-02-21

## Dependencies
- Requires: PROJ-1 (SMARD Datenintegration) - für historische Daten

## User Stories
- Als CEO möchte ich den Jahresverlauf auf einen Blick sehen
- Als Produkt-Manager möchte ich interessante Tage (Highlights) identifizieren
- Als Decision Maker möchte ich monatliche Aggregation sehen

## Acceptance Criteria
- [ ] Neue Seite `/yearly` oder Tab im Dashboard
- [ ] Monats-Chart: Linien- oder Bar-Chart mit Durchschnittspreisen pro Monat
- [ ] Highlight-Tage: Top 5 Tage mit höchster Volatilität (größte Preisspanne)
- [ ] Highlight-Tage: Top 3 Tage mit negativen Preisen (wenn vorhanden)
- [ ] Klick auf Highlight = Wechsel zu Tagesansicht mit diesem Datum
- [ ] Jahres-KPIs: Durchschnittspreis, günstigster Monat, teuerster Monat
- [ ] Jahr-Auswahl: Dropdown für verschiedene Jahre (2023, 2024, 2025)

## UI Spec

**Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│  Jahresübersicht                                   [2024 ▼]│
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  KPIs                                                         │
│  ┌───────────┬───────────┬───────────┬───────────┐          │
│  │⌀ Ø-Preis  │📉 Min     │📈 Max     │💰 Volatil  │          │
│  │  82 ct    │  45 ct    │ 320 ct    │  275 ct   │          │
│  └───────────┴───────────┴───────────┴───────────┘          │
│                                                               │
│  Monatsverlauf (Preis)                                        │
│  350┤      █                                                  │
│  300┤      █      █                                          │
│  250┤      █      █  █                                       │
│  200┤  █   █      █  █  █                                    │
│  150┤  █   █  █   █  █  █  █                                 │
│  100┤  █   █  █   █  █  █  █  █                              │
│   50┤  █   █  █   █  █  █  █  █  █   █                       │
│    0┼──█───█──█───█──█──█──█──█──█───█───                    │
│      Jan Feb Mär Apr Mai Jun Jul Aug Sep Okt Nov Dez          │
│                                                               │
│  Highlights (Top Volatile Days)                               │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ 📅 15. Okt 2024  │  Spanne: 450 ct  │  [Ansehen →] │     │
│  │ 📅 08. Feb 2024  │  Spanne: 380 ct  │  [Ansehen →] │     │
│  │ 📅 22. Nov 2024  │  Spanne: 320 ct  │  [Ansehen →] │     │
│  └─────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

## Data Requirements
- **Aggregation:** Tagespreise → Monatsdurchschnitt
- **Volatilität:** `max(preis) - min(preis)` pro Tag
- **Highlights:** Sortiert nach Volatilität (Top 5)
- **Negative Preise:** Extraktor für Tage mit `min(preis) < 0`

## Edge Cases
- **Was wenn kein Jahr gewählt?** → Aktuelles Jahr als Default
- **Was bei fehlenden Daten für Monate?** → Lücke im Chart mit Tooltip "Keine Daten"
- **Was wenn kein Tag mit negativen Preisen?** → Kategorie nicht anzeigen
- **Was bei sehr flachen Jahresverlauf?** → Y-Achse auto-scale mit Padding
- **Was wenn Jahr in der Zukunft?** → "Prognose" Label, nur verfügbare Daten

## Technical Requirements
- **Data Fetch:** Alle Daten eines Jahres auf einmal (oder lazy loading)
- **Performance:** Monats-Chart < 500ms, Highlights < 200ms
- **State Management:** Ausgewähltes Jahr im URL Query Param `?year=2024`
- **Linking:** Highlight-Klick navigiert zu `/?date=2024-10-15`

## Visual Design
- **Monats-Chart:** Bar-Chart (Balken) oder Line-Chart
- **Highlights:** Karten-Layout mit Icon, Datum, Metrik, Button
- **Farben:** Gleiche Palette wie Tagesansicht (Konsistenz)

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_

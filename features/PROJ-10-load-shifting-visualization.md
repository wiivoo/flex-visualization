# PROJ-10: Baseline vs. Load Shifting Visualisierung

## Status: In Progress
## Created: 2026-02-22
## Dependencies: PROJ-2 (Optimierungsalgorithmus), PROJ-9 (Multi-Source Preisdaten)

## Beschreibung

Zentrale Business-Case-Visualisierung: Zeigt dem Management den direkten Vergleich zwischen "dummem" Laden (Baseline) und optimiertem Load Shifting. Die Kernfrage wird visuell beantwortet: "Was kostet Laden ohne Steuerung vs. mit intelligenter Steuerung?"

## Konzept

**Baseline** = Fahrzeug lädt sofort bei Ankunft (window_start), chronologisch bis voll → typischerweise teuer (Abendspitze 18-22 Uhr)

**Load Shifting** = Laden wird in günstigste Stunden verschoben → typischerweise günstig (Nacht-NT 00-06 Uhr)

## User Stories

1. Als CEO möchte ich auf einen Blick sehen, wie viel Geld Load Shifting spart
2. Als CFO möchte ich die monatlichen/jährlichen Gesamteinsparungen sehen
3. Als Vertrieb möchte ich einem Kunden zeigen: "So sieht Ihre Ersparnis aus"

## Akzeptanzkriterien

### Tagesansicht
- [ ] Preiskurve als Hintergrund mit zwei Overlay-Bereichen:
  - Rote Balken: Wann "dummes" Laden stattfinden würde (Baseline)
  - Grüne Balken: Wann optimiertes Laden stattfindet
- [ ] Text-Annotation: "Laden verschoben: 18:00 → 02:00"
- [ ] Kostenvergleich: Baseline X EUR vs. Optimiert Y EUR + Ersparnis-Badge

### Monats-/Jahresansicht
- [ ] Tägliche Balken: Baseline-Kosten (rot) vs. Optimiert (grün)
- [ ] Kumulative Ersparnislinie über den Zeitraum
- [ ] KPI-Karten: Gesamt gespart, Ø Ersparnis/Tag, Tage analysiert, kWh verschoben

### Batch-Optimierung
- [ ] Server-seitiger Batch-Endpoint für Multi-Tag-Optimierung
- [ ] Pro Tag werden Baseline + Optimiert berechnet und aggregiert
- [ ] Ergebnisse werden gecacht für schnelle Wiederholung

## Technische Details

### Neuer Endpoint
```
POST /api/optimize/batch
Body: { startDate, endDate, vehicle, config, dso? }
Response: { daily_results: [...], totals: { total_savings, avg_per_day, ... } }
```

### Dateien
| Datei | Aktion |
|-------|--------|
| `src/lib/optimizer.ts` | NEU - Extrahierte Optimierungslogik |
| `src/app/api/optimize/batch/route.ts` | NEU - Batch-Endpoint |
| `src/components/dashboard/LoadShiftingComparison.tsx` | NEU - Hauptkomponente |
| `src/app/api/optimize/route.ts` | EDIT - Baseline hinzufügen |
| `src/lib/config.ts` | EDIT - baseline_schedule Typ |
| `src/app/page.tsx` | EDIT - Integration |

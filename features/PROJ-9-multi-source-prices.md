# PROJ-9: Multi-Source Strompreisdaten

## Status: In Progress
## Created: 2026-02-22
## Dependencies: PROJ-1 (SMARD Datenintegration)

## Beschreibung

Erweiterung der Preisdaten-Infrastruktur um mehrere Datenquellen für deutsche Strommarktpreise. Statt nur SMARD werden nun aWATTar (EPEX Spot) und Energy-Charts (Fraunhofer ISE) als zusätzliche Quellen integriert. Die erweiterte Fallback-Kette stellt maximale Datenverfügbarkeit sicher.

## Datenquellen

| Quelle | Typ | Auth | Besonderheit |
|--------|-----|------|-------------|
| aWATTar | Day-Ahead (EPEX) | Keine | Einfache REST API, 100 Queries/Tag |
| SMARD | Day-Ahead | Keine | Bundesnetzagentur, wöchentliche Chunks |
| Energy-Charts | Day-Ahead+ | Keine | Fraunhofer ISE, Range-Support |
| CSV | DA + Intraday | Lokal | 2023-2030, Hourly + 15-Min |

### Erweiterte Fallback-Kette
```
Cache → aWATTar → SMARD → Energy-Charts → CSV → Demo
```

## User Stories

1. Als CEO möchte ich sehen, woher die Preisdaten kommen (Quellen-Badge)
2. Als Analyst möchte ich zwischen Day-Ahead, Intraday und Forward-Preisen wählen können
3. Als System soll die Datenverfügbarkeit durch mehrere Quellen maximiert werden

## Akzeptanzkriterien

- [ ] aWATTar API liefert Day-Ahead Preise für aktuelle/historische Tage
- [ ] Energy-Charts API als zusätzlicher Fallback funktioniert
- [ ] Quellen-Badge zeigt im Dashboard, woher die Daten stammen
- [ ] Fallback-Kette greift automatisch bei Ausfällen
- [ ] Batch-Endpoint nutzt Range-fähige APIs effizient (ein Request statt viele)
- [ ] Preis-Typ-Auswahl (Day-Ahead/Intraday/Forward) in Konfiguration

## Technische Details

### aWATTar API
```
GET https://api.awattar.de/v1/marketdata?start={unix_ms}&end={unix_ms}
Response: { data: [{ start_timestamp, end_timestamp, marketprice (EUR/MWh) }] }
```

### Energy-Charts API
```
GET https://api.energy-charts.info/price?bzn=DE-LU&start=YYYY-MM-DD&end=YYYY-MM-DD
Response: { unix_seconds: [...], price: [...] } (EUR/MWh)
```

### Dateien
| Datei | Aktion |
|-------|--------|
| `src/lib/awattar.ts` | NEU |
| `src/lib/energy-charts.ts` | NEU |
| `src/app/api/prices/route.ts` | EDIT |
| `src/app/api/prices/batch/route.ts` | EDIT |
| `src/lib/price-cache.ts` | EDIT |
| `src/lib/config.ts` | EDIT |
| `src/app/page.tsx` | EDIT |

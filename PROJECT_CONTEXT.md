# Project Context - FlexMon Dashboard

## Project Overview
**FlexMon Dashboard** - Ein Visualisierungs-Tool für das Top-Management zur Demonstration der Strommarkt-Flexibilitäts-Monetarisierung durch E-Auto-Ladesteuerung.

## Tech Stack

- **Framework:** Next.js 16.1.1 (App Router)
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS
- **Backend:** Supabase (PostgreSQL + Auth + Storage)
- **Package Manager:** npm
- **Charts:** Recharts / Chart.js (TODO: choose)
- **Data Source:** SMARD.de (Bundesnetzagentur - deutsche Strommarktpreise)

## Business Concept

### Das Problem
- Strompreise schwanken im Tagesverlauf (teuer abends, günstig nachts)
- E-Autos müssen geladen werden - aber WANN?
- Ohne Smart Charging: Laden zu teuren Zeiten
- Mit Smart Charging: Arbitrage-Gewinn möglich

### Die Lösung
- **Curtailment/Shift:** Laden in günstige Zeitfenster verschieben
- **Win-Win:** Kunde spart, wir verdienen an der Marge
- **Skalierbar:** Je mehr Autos, desto größer die Flexibilität

### Zielgruppe
- **Primary:** CEO/CFO Level (nicht-technisch)
- **Ziel:** Visuelle Darstellung des Business Case für Präsentationen

## Folder Structure

```
src/
  app/                    Next.js App Router pages
    page.tsx             Haupt-Dashboard
    api/                 API Routes
      smard/             SMARD Daten-Proxy
      optimize/          Optimierungsalgorithmus
  components/
    ui/                  shadcn/ui components
    charts/              Chart-Komponenten
    config/              Szenario-Konfigurator
  lib/
    supabase.ts         Supabase Client
    smard.ts            SMARD API Integration
    optimizer.ts        Lade-Optimierungsalgorithmus
  types/                TypeScript Interfaces
public/                 Static assets
```

## Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://mksonztkbdczsjdvjksk.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbG...

# Dashboard Security
DASHBOARD_PASSWORD=super_secure_password

# SMARD API (optional - für Proxy)
SMARD_API_URL=https://smard.de/app/chart_data/v1
```

## Key Parameters (Configurable)

### Fahrzeug-Kategorien
| Typ | Batterie | Ladeleistung | Beispiel |
|-----|----------|--------------|----------|
| Klein | 40-50 kWh | 11 kW | Zoe, ID.3 |
| Mittel | 60-75 kWh | 11-22 kW | Model 3, Y |
| SUV | 80-100 kWh | 22 kW | e-tron, EQS |

### Optimierungs-Parameter
- **Zeitintervalle:** 15 Minuten (96 Werte/Tag)
- **Ladezeitfenster:** Nacht (22:00 - 06:00 Uhr)
- **Strompreis:** Einstellbar (Default 35 ct/kWh)
- **Marge:** Fix ct/kWh auf Arbitrage-Gewinn

### Daten
- **Quelle:** SMARD.de (Bundesnetzagentur)
- **Markt:** Deutschland Day-Ahead / Intraday
- **Granularität:** 15-Minuten-Intervalle
- **Historie:** Verfügbar seit Jahren

## Visualisierungen (MVP)

1. **Preis-Chart:** 24h Strompreisverlauf mit markierten optimalen Ladezeiten
2. **Heatmap:** Uhrzeit vs Autotyp (Gewinn-Schema)
3. **KPI-Karten:** Groß, klar - Gewinn/Monat, Gewinn/Jahr
4. **Vergleich:** Mit Flex vs. Ohne Flex (Vorher-Nachher)
5. **Jahresübersicht:** Monatswerte mit Highlights

## Workflow

1. **Requirements** → Feature-Specs erstellen
2. **Architecture** → Technisches Design
3. **Frontend** → Dashboard UI bauen
4. **Backend** → SMARD Integration + Optimierung
5. **QA** → Testen gegen Akzeptanzkriterien
6. **Deploy** → Vercel Deployment

## Current Status
- ✅ Projekt Setup complete
- ✅ Supabase verbunden
- ✅ Requirements Phase startet jetzt
- 🔄 PRD erstellt
- 🔄 Feature Specs in Arbeit

## Timeline
- **MVP Target:** < 1 Woche
- **Sprint:** Rapid Prototyping für Management Demo

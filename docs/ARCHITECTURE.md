# FlexMon Dashboard - Technical Architecture

**Created:** 2025-02-21
**Status:** MVP Design

## System Overview

FlexMon ist ein Server-Side Rendered Next.js Dashboard das echte deutsche Strommarktpreise abruft, optimale Ladezeiten berechnet und für nicht-technische Entscheidungsträger visualisiert.

```
┌─────────────────────────────────────────────────────────────────────┐
│                          USER (Browser)                              │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  FlexMon Dashboard (Passwort geschützt)                       │  │
│  │  ┌───────────────┐ ┌───────────────┐ ┌───────────────────────┐│  │
│  │  │ Preis-Chart   │ │ KPI-Karten    │ │ Konfigurator         ││  │
│  │  │ (Recharts)    │ │ (Zahlen)      │ │ (Fahrzeug, Preise)   ││  │
│  │  └───────────────┘ └───────────────┘ └───────────────────────┘│  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ HTTPS (API Calls)
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      NEXT.JS APP (Vercel)                            │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Middleware (Passwort-Schutz)                                  │  │
│  │  - Prüft Cookie bei jeder Anfrage                             │  │
│  │  - Redirect zu /login wenn nicht authentifiziert              │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                  │                                  │
│  ┌─────────────────────┐  ┌──────────────────────────────────────┐ │
│  │  /api/prices        │  │  /api/optimize                        │ │
│  │  - Holt Awattar     │  │  - Berechnet optimale Ladezeiten      │ │
│  │    Strompreise      │  │  - Ersparnis, Marge, Kunde           │ │
│  │  - Cache Check      │  │                                      │ │
│  │  - Fallback Demo    │  │                                      │ │
│  └─────────────────────┘  └──────────────────────────────────────┘ │
│                                  │                                  │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Data Layer                                                    │  │
│  │  - Supabase (Cache für Preis-Daten)                          │  │
│  │  - Demo-Daten (Fallback)                                      │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ Fetch (extern)
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    SMARD API (Primary - Day-Ahead)                    │
│              https://smard.api.bund.dev (Filter 4169)               │
│                    Marktpreis DE/LU, quarterhour                     │
│                                                                   │
│              CSV Files (Fallback - Local Data)                      │
│              /csvs/spot_price_*.csv, intraday_price_*.csv           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## A) Component Structure (Dashboard)

```
/app (Login Page)
  └── LoginPage
      ├── PasswordInput
      └── LoginForm

/app/page.tsx (Main Dashboard)
  └── DashboardLayout
      ├── Header
      │   ├── Title ("FlexMon Dashboard")
      │   └── DateSelector (Kalender/Vor-Zurück)
      ├── KPIGrid (4 Karten)
      │   ├── KPICard (Ersparnis)
      │   ├── KPICard (Marge/Monat)
      │   ├── KPICard (Kunden-Vorteil)
      │   └── KPICard (Beste Zeit)
      ├── PriceChartSection
      │   ├── PriceChart (Recharts Linie)
      │   │   ├── X-Achse (Uhrzeit 00-24h)
      │   │   ├── Y-Achse (ct/kWh)
      │   │   ├── Linie (Preisverlauf)
      │   │   └── Highlight Zone (Optimale Ladezeit grün)
      │   └── ChartTooltip (Hover Info)
      └── ConfigSidebar (rechts)
          ├── VehicleSelector (Klein/Mittel/SUV)
          ├── PriceInputs (Basis, Marge, Rabatt)
          ├── ChargingSettings (Start %, Zeitfenster)
          └── ActionButtons (Reset, Apply)

/components
  ├── ui/ (shadcn/ui - vorhanden)
  ├── charts/
  │   ├── PriceChart.tsx
  │   └── Heatmap.tsx (für PROJ-4)
  ├── config/
  │   └── ConfigPanel.tsx
  └── kpi/
      └── KPICard.tsx
```

---

## B) Data Model

### Supabase Tables (Cache)

**`price_cache`** - Gespeicherte Preis-Daten
```
Jeder Datensatz repräsentiert einen Tag (24 Werte à 1h):

- date (Date, Primary Key) - z.B. "2025-02-21"
- timestamp (Timestamptz) - Wann gecached
- prices_json (JSONB) - Array von {time, price}
  Example: [{"00:00", 80}, {"00:15", 75}, ...]
- source (Text) - "awattar" oder "demo"

Cache Strategy:
- Vor Abruf: Check ob Datum vorhanden + < 24h alt
- Wenn ja: Return gecachte Daten
- Wenn nein: Fetch SMARD, speichern, return
```

### Client State (React / LocalStorage)

**Konfiguration** (bleibt zwischen Seiten)
```
{
  vehicle: "medium",           // klein | medium | suv
  base_price_ct_kwh: 35,       // Normaler Strompreis
  margin_ct_kwh: 5,            // Unsere Marge
  customer_discount_ct_kwh: 12,// Kunden-Vorteil
  start_level_percent: 20,     // Batterie Start
  window_start: "22:00",       // Laden ab
  window_end: "06:00"          // Laden bis
}
```

**Session** (für API Calls)
```
{
  selectedDate: "2025-02-21",  // Angezeigter Tag
  prices: Array<{time, price}>, // Vom API geladen
  optimization: {               // Ergebnis von /api/optimize
    schedule: [...],
    savings: 18.36,
    margin: 1.10,
    ...
  }
}
```

---

## C) API Routes Structure

```
/app/api/
├── auth/
│   └── route.ts          - POST: Prüft Passwort, setzt Cookie
├── prices/
│   └── route.ts          - GET: ?date=YYYY-MM-DD → Preisdaten
├── optimize/
│   └── route.ts          - POST: Preise + Config → Optimales Ladeschema
└── logout/
    └── route.ts          - POST: Löscht Cookie
```

### API: `/api/prices`
**Input:** Query Param `?date=2025-02-21`
**Output:**
```json
{
  "date": "2025-02-21",
  "source": "awattar",  // oder "demo" bei Fallback
  "prices": [
    {"time": "00:00", "price_ct_kwh": 8.0},
    {"time": "01:00", "price_ct_kwh": 7.5},
    ...
  ]
}
```

### API: `/api/optimize`
**Input:**
```json
{
  "prices": [...],           // Vom prices API
  "vehicle": "medium",       // oder klein/suv
  "config": {
    "start_level": 20,
    "window_start": "22:00",
    "window_end": "06:00",
    "base_price_ct_kwh": 35,
    "margin_ct_kwh": 5,
    "customer_discount_ct_kwh": 12
  }
}
```
**Output:**
```json
{
  "charging_schedule": [
    {"start": "02:00", "end": "04:30", "price_ct_kwh": 12, "kwh": 22}
  ],
  "cost_without_flex_eur": 21.00,
  "cost_with_flex_eur": 2.64,
  "savings_eur": 18.36,
  "customer_benefit_eur": 8.40,
  "our_margin_eur": 1.10,
  "win_win_eur": 9.50
}
```

---

## D) Tech Decisions (WHY)

| Entscheidung | Begründung |
|--------------|------------|
| **Next.js App Router** | Server-Side Rendering = schnelle Ladezeit, SEO-freundlich, gute API-Integration |
| **TypeScript** | Typensicherheit für komplexe Datenstrukturen (Preise, Optimierung) |
| **Tailwind CSS** | Schnelles Styling, konsistentes Design |
| **shadcn/ui** | Professionelle Components ohne eigenen UI-Code zu schreiben |
| **Recharts** | React-native, einfach für Liniendiagramme, responsive |
| **Supabase Cache** | Preis-Daten ändern sich nicht - Cache reduziert API Calls |
| **Middleware Auth** | Einfacher Passwortschutz ohne komplexe User-DB |
| **LocalStorage Config** | Konfiguration bleibt pro User gespeichert, kein Server nötig |

---

## E) Data Flow

```
1. USER öffnet Dashboard
   ↓
2. MIDDLEWARE prüft Cookie
   - Kein Cookie? → Redirect /login
   - Cookie ok? → Weiter zu /page
   ↓
3. DASHBOARD lädt
   - LocalStorage für Config lesen (oder Defaults)
   - API Call: /api/prices?date=heute
   ↓
4. API PRICES
   - Check Supabase Cache für Datum
   - Cache hit? → Return
   - Cache miss? → Fetch ENTSO-E API (Primary)
     - Success? → Speichern in Supabase, Return
     - Error? → Fallback Awattar API
       - Success? → Speichern, Return
       - Error? → Return Demo-Daten
   ↓
5. DASHBOARD erhält Preise
   - API Call: /api/optimize (Preise + Config)
   ↓
6. API OPTIMIZE
   - Algorithmus: Finde günstigste X Stunden im Zeitfenster
   - Berechne: Ersparnis, Marge, Kunde
   - Return Ergebnis
   ↓
7. DASHBOARD render
   - Recharts Preis-Chart mit optimierter Zone
   - KPI-Karten mit Zahlen
   - Heatmap mit Fahrzeugvergleich
```

---

## F) Security

**Passwortschutz (Middleware)**
```
- Environment: DASHBOARD_PASSWORD (in .env.local)
- Login: POST /api/auth mit Passwort
- Cookie: HttpOnly, Secure, SameSite=Strict, 24h valide
- Algorithmus: SHA-256 Hash Vergleich

Keine User-DB, keine Sessions in Supabase - einfacher "shared password" Ansatz
```

---

## G) Dependencies to Install

```bash
# Chart Library
npm install recharts

# Utils (wahrscheinlich schon da)
npm install date-fns  # Für Datum-Manipulation

# Supabase (bereits installiert)
npm install @supabase/supabase-js

# Password Hashing
npm install @types/crypto-js  # Oder Web Crypto API
```

---

## H) Fahrzeug-Profile (Config)

```javascript
const VEHICLE_PROFILES = {
  klein: {
    name: "Kleinwagen",
    battery_kwh: 45,
    charge_power_kw: 11,
    range_km: 250,
    examples: "Zoe, ID.3, Mini E"
  },
  medium: {
    name: "Mittelklasse",
    battery_kwh: 60,
    charge_power_kw: 22,
    range_km: 350,
    examples: "Model 3, Hyundai Ioniq 6"
  },
  suv: {
    name: "SUV",
    battery_kwh: 100,
    charge_power_kw: 22,
    range_km: 450,
    examples: "Audi e-tron, EQS, Model X"
  }
}
```

---

## I) File Structure Overview

```
src/
├── app/
│   ├── login/
│   │   └── page.tsx                 # Login Screen
│   ├── page.tsx                     # Haupt-Dashboard
│   ├── layout.tsx                   # Root Layout
│   ├── api/
│   │   ├── auth/route.ts           # Login Endpoint
│   │   ├── smard/prices/route.ts   # Preis-Daten
│   │   └── optimize/route.ts       # Optimierung
│   └── middleware.ts                # Passwort-Schutz
├── components/
│   ├── charts/
│   │   ├── PriceChart.tsx          # Haupt-Chart
│   │   └── Heatmap.tsx             # Für PROJ-4
│   ├── config/
│   │   └── ConfigPanel.tsx         # Seitenleiste
│   ├── kpi/
│   │   └── KPICard.tsx             # KPI-Karten
│   └── ui/                         # shadcn/ui (bereits da)
├── lib/
│   ├── supabase.ts                 # (bereits da)
│   ├── smard.ts                    # SMARD API Client (Primary)
│   ├── csv-prices.ts               # CSV Parser (Fallback - /csvs/*.csv)
│   ├── optimizer.ts                # Optimierungs-Algorithmus
│   ├── types.ts                    # TypeScript Interfaces
│   └── config.ts                   # Fahrzeug-Profiles
└── types/
    └── index.ts                    # Shared Types
```

---

## J) Fallback Strategy

```
1. Try SMARD API (Primary - Filter 4169)
   ├─ Day-Ahead Prices (quarterhour/hour)
   └─ Marktpreis DE/LU

2. On Error → Try CSV Files (/csvs/)
   ├─ spot_price_YYYY.csv (Day-Ahead)
   └─ intraday_price_YYYY.csv (Intraday)

3. Still Error → Demo-Data
```

**CSV Files Location:** `/csvs/`
- spot_price_2023.csv → spot_price_2030.csv
- intraday_price_2023.csv → intraday_price_2030.csv
- Format: `timestamp,price (€/MWh)`

---

## K) Next Steps

Build Order (gemäß Dependencies):
1. **PROJ-6** (Passwortschutz) - Middleware + Login
2. **PROJ-1** (Strompreise) - SMARD API + CSV Fallback + Cache
3. **PROJ-2** (Optimize) - Algorithmus + API
4. **PROJ-5** (Config) - Panel + LocalStorage
5. **PROJ-3** (Chart) - Haupt-Dashboard + Recharts

Parallel möglich (nach PROJ-1):
- PROJ-2 und PROJ-5 können parallel entwickelt werden

---

## L) Data Sources

### Primary: SMARD API (Bundesnetzagentur)

**Warum SMARD?**
- Offizielle deutsche Strommarktdaten
- Filter 4169 = Marktpreis DE/LU
- JSON Format, kein API Key nötig
- quarterhour (15-min) + hour Auflösung

**SMARD API Details:**
- Base URL: `https://www.smard.de/app/chart_data`
- Filter: `4169` = Marktpreis Deutschland/Luxemburg
- Region: `DE`
- Auflösung: `quarterhour` | `hour`
- Umrechnung: `ct/kWh = EUR/MWh / 10`

### Fallback: CSV Files (/csvs/)

**Vorhandene Daten:**
- spot_price_2023.csv → spot_price_2030.csv (Day-Ahead)
- intraday_price_2023.csv → intraday_price_2030.csv (Intraday)
- Format: `timestamp,price (€/MWh)`
- 15-Minuten-Intervalle

### Data Types Summary

| Type | SMARD | CSV | Demo |
|------|-------|-----|------|
| Day-Ahead | ✅ 4169 | ✅ spot_* | ✅ |
| Intraday | ❌ (nur Day-Ahead) | ✅ intraday_* | ❌ |
| Forward | ❌ (nur historisch) | ✅ (historisch) | ❌ |

---

**Architecture Review:**
- ✅ API Routes definiert
- ✅ Component Struktur visuell
- ✅ Data Model (Supabase + LocalStorage)
- ✅ Data Flow (User → Middleware → API → SMARD → Back)
- ✅ Security (Middleware Passwortschutz)
- ✅ Dependencies gelistet

**Nächster Schritt:** `/frontend` für PROJ-6 (Passwortschutz) oder PROJ-3 (Dashboard UI)

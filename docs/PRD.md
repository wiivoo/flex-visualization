# Product Requirements Document - FlexMon Dashboard

## Vision
FlexMon Dashboard ist ein Visualisierungs-Tool für das Top-Management, das demonstriert, wie E-Auto-Ladesteuerung (Flexibilität) im deutschen Strommarkt monetarisiert werden kann. Das Dashboard zeigt anhand echter Marktpreise, wie Kunden durch flexible Ladezeiten sparen und gleichzeitig Arbitrage-Gewinne entstehen - ein Win-Win-Szenario für beide Seiten.

## Target Users
- **Primary:** CEO/CFO Level (nicht-technisch)
  - Need: Visuelle, leicht verständliche Darstellung des Business Case
  - Pain Point: Komplexe Energy-Trade-Konzepte sind schwer zu greifen
- **Secondary:** Product Manager, Sales Teams
  - Need: Zahlen und Material für Kundenpräsentationen

## Core Features (Roadmap)

| Priority | Feature | Status |
|----------|---------|--------|
| P0 (MVP) | SMARD Datenintegration | Planned |
| P0 (MVP) | Preis-Optimierungsalgorithmus | Planned |
| P0 (MVP) | Dashboard Visualisierungen | Planned |
| P0 (MVP) | Szenario-Konfigurator | Planned |
| P0 (MVP) | Passwortschutz | Planned |
| P1 | Export (PDF/Excel) | Planned |
| P1 | Historische Daten-Archive | Planned |
| P2 | Multi-Portfolio-Vergleich | Planned |

## Success Metrics
- Management versteht das Flexibilitäts-Konzept innerhalb von 5 Minuten
- Dashboard kann für Kundenpräsentationen verwendet werden
- Zahlen basieren auf echten Marktdaten (nicht erfunden)

## Constraints
- **Timeline:** MVP in < 1 Woche
- **Complexity:** Einfach genug für nicht-technische Entscheidungsträger
- **Data:** Echte deutsche Strommarktpreise (SMARD.de)
- **Language:** Deutsch

## Non-Goals
- Keine Benutzer-Auth mit individuellen Accounts (nur Passwortschutz)
- Keine Live-Preisprognosen (historische + aktuelle Daten reichen)
- Keine Integration in echte Ladeinfrastruktur (nur Simulation)
- Keine automatischen Trades/Orders (nur Visualisierung)

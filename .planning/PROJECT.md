# FlexMon Dashboard — Project Context

## What This Is

**FlexMon** (EV Flex Charging Dashboard) is a B2C interactive visualization tool that demonstrates the value of smart EV charging through load shifting. It uses real German (and European) day-ahead electricity prices to show how shifting charging sessions to the cheapest hours saves money compared to immediate/"dumb" charging.

**Core Value:** Make the financial benefit of flexible EV charging tangible and easy to understand for end consumers, fleet managers, and business stakeholders.

## Context

- **Domain:** EV charging, energy markets, electricity price optimization
- **Users:** EV drivers, fleet managers, energy company business development
- **Purpose:** Sales/demo tool for flex charging product — shows real savings with real market data
- **Deployment:** Vercel, accessible at web.lhdus.dpdns.org

## Technical Identity

- **Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, Recharts, Supabase
- **Data sources:** SMARD API (DE day-ahead + generation), ENTSO-E (EU day-ahead), aWATTar/Energy Charts (fallbacks)
- **Caching:** Supabase cache with country-prefixed keys, static JSON files via GitHub Actions
- **Auth:** JWT (jose) with password protection
- **Architecture:** Single-page dashboard with client-side optimization engine

## Requirements

### Validated

- ✓ Real-time day-ahead price visualization (hourly + quarter-hourly) — PROJ-1
- ✓ Charging optimization engine (baseline vs. smart) — PROJ-2
- ✓ Password-protected access — PROJ-6
- ✓ Interactive price chart with zoom (12h/24h/72h) — PROJ-12
- ✓ Customer profile configurator (mileage, plug-in frequency, times) — PROJ-17
- ✓ Date picker with spread-colored indicators — PROJ-18, PROJ-28
- ✓ Session cost breakdown (baseline vs. optimized) — PROJ-19
- ✓ Monthly savings chart — PROJ-20
- ✓ Savings sensitivity heatmap (mileage × frequency) — PROJ-21
- ✓ Savings potential summary box — PROJ-22
- ✓ URL state persistence & sharing — PROJ-23
- ✓ Weekday/weekend charging split — PROJ-24
- ✓ Fleet portfolio view — PROJ-25
- ✓ Spread indicators & scenario cards — PROJ-27
- ✓ Two-column layout & UX refresh — PROJ-28

### Active

- [ ] V2G dual value streams — PROJ-29 (In Progress)
- [ ] Multi-country support (NL via ENTSO-E) — code exists but UI disabled
- [ ] EPEX intraday price integration — scraper exists

### Out of Scope

- Mobile app — web-only for now
- User accounts / multi-tenant — single password auth
- Real-time bidding / trading — visualization only
- Battery degradation modeling — out of scope

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| SMARD as primary DE data source | Free, reliable, official German data | ✓ Working |
| ENTSO-E for non-DE countries | Pan-European coverage, standard API | Partial (NL exists, UI disabled) |
| Static JSON + incremental API | Fast first paint, then fill gaps | ✓ Working |
| Client-side optimization | No server load, instant recalculation | ✓ Working |
| Supabase for caching | Free tier sufficient, serverless | ✓ Working |
| Single monolithic Step2 component | Iterative development, will refactor | Tech debt |

## Constraints

- **Budget:** Vercel free/hobby tier, Supabase free tier
- **Data:** SMARD updates with ~2 day delay; ENTSO-E can be unreliable (503s)
- **Performance:** Bundle size matters (Recharts is heavy)
- **Browser:** Desktop-first (1440px), mobile is secondary

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-26 after initialization*

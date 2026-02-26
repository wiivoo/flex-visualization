# PROJ-23: URL State & Sharing

**Status:** Deployed
**Location:** `src/app/v2/page.tsx` (lines 10–93)

## Description

All scenario parameters are synced to URL search params, making the current view shareable via a simple link.

## URL Parameters

| Param | Description | Default |
|-------|-------------|---------|
| `date` | Selected date (YYYY-MM-DD) | Second-to-last available |
| `mileage` | Yearly km | 15000 |
| `plugins` | Weekly plug-ins | 4 |
| `plugin_time` | Plug-in hour | 18 |
| `departure` | Departure hour | 7 |
| `mode` | `fullday` or omitted for overnight | overnight |

## Share Button

Header button copies current URL to clipboard. Fallback chain: `navigator.clipboard` → `document.execCommand('copy')` → `window.prompt`.

## State Sync

- URL → state: parsed on mount (`parseScenario`)
- State → URL: `useEffect` replaces URL on every scenario/date change (no history push)

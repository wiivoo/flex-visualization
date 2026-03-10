# PROJ-23: URL State & Sharing

**Status:** Deployed
**Location:** `src/app/v2/page.tsx`

## Description

All scenario parameters are synced to URL search params, making the current view shareable via a simple link.

## URL Parameters

| Param | Description | Default |
|-------|-------------|---------|
| `date` | Selected date (YYYY-MM-DD) | Second-to-last available |
| `mileage` | Yearly km | 15000 |
| `plugins_wd` | Weekday plug-ins (Mon-Fri, 0-5) | 3 |
| `plugins_we` | Weekend plug-ins (Sat-Sun, 0-2) | 1 |
| `plugin_time` | Plug-in hour | 18 |
| `departure` | Departure hour | 7 |
| `mode` | `fullday`, `threeday`, or omitted for overnight | overnight |
| `power` | Wallbox power in kW (only serialized if != 7) | 7 |

## Backward Compatibility

Old `plugins` parameter (single integer 1-7) is automatically converted:
- `plugins_wd = min(plugins, 5)`
- `plugins_we = max(0, plugins - 5)`

## Share Button

Header button copies current URL to clipboard. Fallback chain: `navigator.clipboard` -> `document.execCommand('copy')` -> `window.prompt`.

## State Sync

- URL -> state: parsed on mount (`parseScenario`)
- State -> URL: `useEffect` replaces URL on every scenario/date change (no history push)
- Mode serialization: overnight = omitted (default), fullday/threeday = written to `mode` param

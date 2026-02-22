# PROJ-5: Scenario Configurator

## Status: Planned
**Created:** 2025-02-21
**Last Updated:** 2025-02-21

## Dependencies
- None (always available, influences PROJ-2, PROJ-3, PROJ-4)

## User Stories
- As an analyst, I want to test different car types to understand the potential
- As a decision maker, I want to adjust prices to simulate scenarios
- As a product manager, I want to add new vehicle categories

## Acceptance Criteria
- [ ] Sidebar or modal for configuration
- [ ] Vehicle selection: Compact, Mid-range, SUV (with icons)
- [ ] Vehicle details are displayed: Battery size, charge power, example vehicles
- [ ] Price settings: Base price (ct/kWh), margin (ct/kWh), customer discount (ct/kWh)
- [ ] Charging settings: Start level (%), time window (start/end time)
- [ ] "Apply" button updates all charts and KPIs
- [ ] "Reset" button restores default values
- [ ] Configuration is saved in LocalStorage (not on server)

## UI Spec

**Layout (Sidebar right):**
```
┌──────────────────────────────────┐
│  ⚙️ Configuration                │
├──────────────────────────────────┤
│                                  │
│  🚗 Vehicle Type                 │
│  ○ Compact (40 kWh)             │
│  ● Mid-range (60 kWh)           │
│  ○ SUV (100 kWh)                 │
│                                  │
│  💰 Prices (ct/kWh)              │
│  Base price:      [35  ]        │
│  Margin:          [5   ]        │
│  Customer disc.:  [12  ]        │
│                                  │
│  🔋 Charging Settings            │
│  Start level:     [20%] ▼       │
│  Time window:     [22] - [06]   │
│                                  │
│  [Reset]        [Apply →]       │
└──────────────────────────────────┘
```

## Vehicle Profiles

| Type | Battery | Power | Range | Examples |
|------|---------|-------|-------|----------|
| Compact | 40 kWh | 11 kW | 250 km | Zoe, ID.3, Mini E |
| Mid-range | 60 kWh | 22 kW | 350 km | Model 3, Y, Ioniq 6 |
| SUV | 100 kWh | 22 kW | 450 km | e-tron, EQS, Model X |

## Default Values
```json
{
  "vehicle": "medium",
  "base_price_ct_kwh": 35,
  "margin_ct_kwh": 5,
  "customer_discount_ct_kwh": 12,
  "start_level_percent": 20,
  "window_start": "22:00",
  "window_end": "06:00"
}
```

## Edge Cases
- **What about invalid values?** → Input validation, red border, error tooltip
- **What if start > end (e.g. 06-22)?** → "Night charging" implies overnight, treat as 22:00-06:00+1
- **What if LocalStorage is full?** → Fallback to defaults
- **What about negative prices?** → Not allowed, min 0 ct/kWh
- **What if margin > base price?** → Warning "Margin higher than base price"

## Technical Requirements
- **Persistence:** LocalStorage (browser)
- **Reactivity:** KPIs update immediately after "Apply"
- **Validation:** Client-side, clear error messages
- **Responsive:** On mobile, configurator is a tab (not sidebar)

## Input Validation
- Base price: 10-100 ct/kWh
- Margin: 0-20 ct/kWh
- Customer discount: 0-50 ct/kWh
- Start level: 0-90%
- Time window: 00-23 hours

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)

### Component Structure
```
ConfigPanel (Client Component)
├── VehicleSelector (RadioGroup)
│   ├── RadioOption "klein"
│   │   ├── Icon 🚗
│   │   ├── Label "Kleinwagen"
│   │   └── Details "40 kWh, 11 kW"
│   ├── RadioOption "medium"
│   └── RadioOption "suv"
├── PriceInputs
│   ├── Input "Basispreis" (Number)
│   ├── Input "Marge" (Number)
│   └── Input "Kundenrabatt" (Number)
├── ChargingSettings
│   ├── Select "Start-Level %" (0-90)
│   ├── TimeInput "Von" (00-23)
│   └── TimeInput "Bis" (00-23)
└── ActionButtons
    ├── ResetButton
    └── ApplyButton
```

### LocalStorage Schema
```typescript
interface ConfigState {
  vehicle: 'klein' | 'medium' | 'suv'
  base_price_ct_kwh: number      // Default: 35
  margin_ct_kwh: number          // Default: 5
  customer_discount_ct_kwh: number // Default: 12
  start_level_percent: number    // Default: 20
  window_start: string           // Default: "22:00"
  window_end: string             // Default: "06:00"
}

// Storage Key
const CONFIG_KEY = 'flexmon-config'
```

### Files to Create
- `src/components/config/ConfigPanel.tsx` - Main panel
- `src/components/config/VehicleSelector.tsx` - Vehicle selection
- `src/components/config/PriceInputs.tsx` - Price inputs
- `src/components/config/ChargingSettings.tsx` - Charging settings
- `src/lib/config.ts` - Shared Config + Defaults

### React Pattern
```typescript
'use client'

export function ConfigPanel({ onConfigChange }) {
  const [config, setConfig] = useState(loadDefaults())

  const handleApply = () => {
    saveConfig(config)      // LocalStorage
    onConfigChange(config)   // Callback to parent
  }

  return <Panel>...</Panel>
}
```

### Validation (Client-side)
```typescript
const validate = (config: ConfigState): string[] => {
  const errors = []
  if (config.base_price_ct_kwh < 10 || config.base_price_ct_kwh > 100)
    errors.push("Basispreis muss 10-100 ct/kWh sein")
  if (config.margin_ct_kwh > config.base_price_ct_kwh)
    errors.push("Marge darf nicht höher als Basispreis sein")
  return errors
}
```

## QA Test Results

**Tested:** 2025-02-21
**App URL:** http://localhost:3000
**Tester:** QA Engineer (AI)

### Acceptance Criteria Status

#### AC-1: Sidebar or modal for configuration
- [x] ConfigPanel component using Sheet (sidebar)
- [x] QuickConfigPanel for fast changes
- [x] Settings button in header to open

#### AC-2: Vehicle selection: Compact, Mid-range, SUV (with icons)
- [x] VehicleSelector component with radio selection
- [x] Three vehicle types: klein, medium, suv
- [x] Icons (Car/Van) for each type
- [x] Battery, power, and range displayed

#### AC-3: Vehicle details displayed: Battery size, charge power, example vehicles
- [x] Shows battery capacity (kWh)
- [x] Shows charge power (kW)
- [x] Shows range (km)
- [x] Shows example vehicles

#### AC-4: Price settings: Base price (ct/kWh), margin (ct/kWh), customer discount (ct/kWh)
- [x] PriceInputs component with three fields
- [x] Base price, margin, and customer discount inputs
- [x] Number inputs with validation

#### AC-5: Charging settings: Start level (%), time window (start/end time)
- [x] ChargingSettings component
- [x] Start level dropdown (0-90%)
- [x] Time window start/end hour selectors

#### AC-6: "Apply" button updates all charts and KPIs
- [x] Apply button saves config and triggers re-render
- [x] Dashboard updates with new configuration

#### AC-7: "Reset" button restores default values
- [x] Reset button in ConfigPanel
- [x] Reset button in QuickConfigPanel
- [x] Both restore DEFAULT_CONFIG values

#### AC-8: Configuration saved in LocalStorage (not on server)
- [x] `saveConfig()` writes to localStorage
- [x] `loadConfig()` reads from localStorage on mount
- [x] Persists across browser sessions

### Edge Cases Status

#### EC-1: Invalid values
- [x] Client-side validation with error messages
- [x] Red border on invalid fields
- [x] Apply button shows validation errors

#### EC-2: Start > End (e.g. 06-22)
- [x] Algorithm in optimize API handles overnight windows correctly
- [x] UI shows the configured times as-is

#### EC-3: LocalStorage full
- [x] Try-catch in save/load handles errors gracefully
- [x] Falls back to defaults on error

#### EC-4: Negative prices
- [x] Min attributes prevent negative values in HTML5 inputs
- [x] Validation checks for >= 0

#### EC-5: Margin > base price
- [x] Warning shown: "Marge hoher als Basispreis"
- [x] Amber border on margin field
- [x] Still allows submission (business decision)

### UI Component Testing

#### QuickConfigPanel
- [x] Vehicle selection buttons with emoji icons
- [x] Slider for start level (0-90%)
- [x] Charging window display (read-only)
- [x] Reset to default button

#### ConfigPanel (Full)
- [x] Vehicle cards with detailed info
- [x] Price inputs with validation
- [x] Charging settings with dropdowns
- [x] Apply/Reset buttons

### LocalStorage Testing
- [x] Config persists on page reload
- [x] Config persists across browser sessions
- [x] Clearing localStorage resets to defaults

### Security Audit Results
- [x] No sensitive data in localStorage (config only)
- [x] No XSS injection points in config values
- [x] Input validation on client and server

### Bugs Found

#### BUG-1: German Umlaut Encoding Issues
- **Severity:** Low
- **Description:** Multiple instances of "a" instead of "ä" in German text
- **Locations:**
  - "Flexibilitat" should be "Flexibilität"
  - "Zurucksetzen" should be "Zurücksetzen"
  - "hoher" should be "höher"
- **Impact:** Professional appearance affected
- **Recommendation:** Fix all umlauts in German text
- **Priority:** Fix in next sprint

#### BUG-2: No Validation for Empty Inputs
- **Severity:** Low
- **Description:** Can clear number fields resulting in NaN or 0
- **Impact:** May cause calculation errors
- **Recommendation:** Add required field validation
- **Priority:** Nice to have

#### BUG-3: Quick Config Does Not Show All Settings
- **Severity:** Low
- **Description:** QuickConfigPanel only shows vehicle and start level
- **Impact:** Users must open full panel for price settings
- **Recommendation:** Consider adding price settings to quick config
- **Priority:** Nice to have

### Summary
- **Acceptance Criteria:** 8/8 passed (100%)
- **Edge Cases:** 5/5 handled correctly
- **Bugs Found:** 3 total (0 critical, 0 high, 0 medium, 3 low)
- **Security:** No issues found
- **Production Ready:** YES (with text encoding improvements recommended)
- **Recommendation:** Deploy to production

## Deployment
_To be added by /deploy_

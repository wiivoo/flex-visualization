# E.ON Design System Reference — FlexMon v2

## Brand Colors

### Core Palette
| Role | Name | Hex | Usage |
|---|---|---|---|
| Primary | E.ON Red | `#EA1C0A` | CTAs, primary actions, key highlights |
| Dark | Mine Shaft | `#313131` | Body text, headings |
| Accent | Tory Blue | `#115BA7` | Links, secondary data series |
| Background Light | Warm White | `#F5F5F2` | Page background, card backgrounds |
| Background Dark | Near Black | `#121218` | Dark sections, contrast areas |
| White | Pure White | `#FFFFFF` | Cards, content areas |

### Extended Palette (Data Visualization)
| Series | Color | Hex | Usage |
|---|---|---|---|
| Series 1 | E.ON Red | `#EA1C0A` | Primary metric, baseline |
| Series 2 | Teal | `#1D9E9E` | Optimized/savings |
| Series 3 | Amber | `#F59E0B` | Warnings, peaks, costs |
| Series 4 | Green | `#22C55E` | Positive outcomes, savings |
| Series 5 | Blue | `#115BA7` | Secondary data, forward prices |
| Neutral | Gray | `#9CA3AF` | Gridlines, labels, borders |

### Semantic Colors
| Role | Hex | Usage |
|---|---|---|
| Positive/Savings | `#22C55E` | Cost savings, green highlights |
| Negative/Cost | `#EA1C0A` | Expensive hours, losses |
| Neutral/Baseline | `#9CA3AF` | Unchanged values, comparisons |
| Info | `#115BA7` | Informational highlights |

## Typography

### Font Stack
```css
font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```
Inter is the closest free match to E.ON's proprietary EON Brix Sans (geometric sans-serif by HVD Fonts).

### Scale
| Element | Size | Weight | Line Height |
|---|---|---|---|
| Hero headline | 48px / 3rem | 700 (Bold) | 1.1 |
| Section title | 32px / 2rem | 600 (SemiBold) | 1.2 |
| Card title | 20px / 1.25rem | 600 (SemiBold) | 1.3 |
| Body | 16px / 1rem | 400 (Regular) | 1.5 |
| Caption | 14px / 0.875rem | 400 (Regular) | 1.4 |
| Label | 12px / 0.75rem | 500 (Medium) | 1.3 |
| KPI number | 40px / 2.5rem | 700 (Bold) | 1.0 |

## Spacing

Base unit: 4px
- `xs`: 4px
- `sm`: 8px
- `md`: 16px
- `lg`: 24px
- `xl`: 32px
- `2xl`: 48px
- `3xl`: 64px

Section padding: 48–64px vertical, 32px horizontal
Card padding: 24px
Content max-width: 1440px

## Components

### Cards
- Background: white
- Border: 1px solid `#E5E7EB`
- Border-radius: 8px (0.5rem)
- Shadow: `0 1px 3px rgba(0,0,0,0.1)` (subtle)
- Padding: 24px

### Buttons
- Primary: `#EA1C0A` background, white text, 8px radius
- Secondary: transparent, `#EA1C0A` border + text
- Hover: darken 10%
- Height: 40px, padding 16px horizontal
- Font: 14px, weight 600

### Navigation (Multi-Step)
- Horizontal step indicator
- Active step: E.ON Red dot/line
- Completed: checkmark
- Upcoming: gray dot
- Step labels below indicators

## Chart Styling

### General
- Background: transparent (inherits card/page bg)
- Grid lines: `#E5E7EB` (light gray), 1px, dashed
- Axis labels: `#6B7280`, 12px, Inter
- Tooltip: white bg, `#313131` text, 8px radius, subtle shadow

### Price Chart
- Line: 2px stroke, E.ON Red or Teal
- Area fill: gradient from color at 20% opacity to transparent
- Charging blocks: green bars at 60% opacity behind line
- Reference lines: dashed, labeled

### Waterfall Chart
- Positive bars: `#22C55E` (green)
- Negative bars: `#EA1C0A` (red)
- Connecting lines: `#9CA3AF` (gray), 1px
- Total bar: `#115BA7` (blue)

### Interactive Elements
- Slider tracks: `#E5E7EB`
- Slider thumb: `#EA1C0A`
- Hover states: highlight with 10% opacity overlay
- Active selection: 2px solid `#EA1C0A` border

## Animation

- Page transitions: 300ms ease-out fade
- Number counters: 500ms ease-out on scroll into view
- Chart drawing: 800ms ease-out line reveal
- Hover effects: 150ms ease

## Responsive (Desktop Only)

- Target: 1440px viewport
- Minimum: 1024px
- Content container: max-width 1280px, centered
- Two-column layouts: 2/3 + 1/3 or 1/2 + 1/2

## Figma Resources (Public)
- [E.ON Design Library](https://www.figma.com/community/file/1464162676686491440/e-on-design-library)
- [E.ON Icon + Pictogram Library](https://www.figma.com/community/file/1464163683049880369/e-on-icon-pictogram-library)

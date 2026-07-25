# Brand — Vanton

_Status: active (approved by Emmanuel, 2026-07-24 — "dark, institutional, amber accent to match the pitch deck")_

Vanton is payments infrastructure for machine commerce on Canton. The brand reads
as an institutional trading terminal, not a consumer crypto app: dark, precise,
numeric, calm. One accent. No gradients, no glassmorphism, no neon.

## Palette (dark-first; the product surface is deliberately single-theme)

| Token | Value | Use |
|---|---|---|
| `ink` | `#0A0F1C` | page background (blue-black, cool) |
| `panel` | `#121A2B` | cards, table rows |
| `panel2` | `#0E1524` | inset surfaces, code/wire blocks |
| `line` | `rgba(233,237,245,0.13)` | 1px borders (borders, not shadows) |
| `text` | `#E9EDF5` | primary text (soft white, no pure #FFF) |
| `muted` | `#95A0B5` | secondary text (AA on ink) |
| `accent` | `#FFB020` | THE accent — terminal amber. CTAs, live indicators, key numbers |
| `onaccent` | `#1A1200` | text on amber |
| `good` | `#3BC9B0` | success/settled only |
| `bad` | `#FF7A70` | errors/rejections only |

Rules: one accent (amber); teal/red are semantic only. Grays are cool-tinted —
never mix warm grays in. Surfaces get *lighter* as they elevate (ink → panel → panel2 inverse for insets).

## Typography

- **UI/body:** system sans — `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
- **Data/numbers/wire:** monospace — `ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace`, always `tabular-nums`
- Eyebrows/labels: 11–12px mono, uppercase, letter-spacing 0.12–0.16em, usually amber or muted
- No webfonts: system stacks are a deliberate choice (build robustness + matches the pitch deck)

## Voice

Institutional-confident, zero hype. Numbers over adjectives. Say "settled on-ledger",
"the ledger rejected it" — never "blazing fast", "revolutionary". Sentence case everywhere,
no exclamation marks in product UI.

## Motif

The HTTP 402 wire flow (`402 Payment Required` → pay → `200 OK`) is the brand's
signature graphic — render as mono text, amber for 402, teal for 200.

# Font palette — Robotic Tech Frox

Source-of-truth for the site's type system. Everything used on the website (index.html, seasons.html, OG image, 3D scenes) is derived from this palette. Bebas Neue is the display face; DM Sans is the body face.

---

## Faces

| Role | Face | Weights | Notes |
|---|---|---|---|
| Display / headings / big numbers | **Bebas Neue** | 400 (regular), 700 (bold) | All-caps, wide letter-spacing, monoline. Used for `h1`, `h2`, `hero`, `stat` numbers, `footer brand`, member names. |
| Body / UI / chips / small caps | **DM Sans** | 400, 500, 600, 700 | Default text. Small-uppercase labels use `font-weight: 700` + `text-transform: uppercase`. |

Google Fonts link used on both pages:

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;700&display=swap">
```

---

## Scales

### Display scale (Bebas Neue)

| Size | Usage |
|---|---|
| 18.4 px | Footer brand |
| 30.4 px | Hero label, `fact.value` fallback |
| 31.2 px | Stat big number (`.stat .value`) |
| 34.4 px | Section head (`.section-head h2`) |
| 40 px | Stat OPR number (`.opr-number`) |
| 54.4 px | Hero `h1` |

### Body scale (DM Sans)

| Size | Usage |
|---|---|
| 10.88 px | Stat label (small caps) |
| 11.52 px | Fact label (small caps) |
| 12.16 px | Chip, eyebrow |
| 12.48 px | Footer note |
| 13.6 px | Member role |
| 14.08 px | Footer link |
| 14.72 px | Nav link |
| 15.2 px | Button |
| 15.36 px | Event name |
| 17.92 px | Hero subtitle (`hero-sub`) |

---

## Type loss (letter-spacing) — display (Bebas Neue)

Applies `letter-spacing` on uppercase display text. Numeric values mirrored so the CSS can round to the grid:

| Size | Letter-spacing | CSS value | Used on |
|---|---|---|---|
| 18.4 px | +0.0753 | 0.92 px | Footer brand |
| 30.4 px | +0.0200 | 0.608 px | Hero label, stat value, stat OPR |
| 34.4 px | +0.0200 | 0.688 px | Section head |
| 54.4 px | +0.0150 | 0.816 px | Hero h1 |

---

## Type loss (letter-spacing) — body (DM Sans)

| Size | Letter-spacing | CSS value | Used on |
|---|---|---|---|
| 10.88 px | +0.1301 | 1.4144 px | Stat label (small caps) |
| 11.52 px | +0.1600 | 1.8432 px | Fact label (small caps) |
| 12.16 px | +0.1800 | 2.1888 px | Chip, eyebrow |
| 12.48 px | +0.0000 | 0 px | Footer note |
| 13.6 px | +0.0000 | 0 px | Member role |
| 14.08 px | +0.0000 | 0 px | Footer link |
| 14.72 px | +0.0000 | 0 px | Nav link |
| 15.2 px | +0.0000 | 0 px | Button |
| 15.36 px | +0.0000 | 0 px | Event name |
| 17.92 px | +0.0000 | 0 px | Hero subtitle |

---

## Line heights

| Face | Line-height | Rule |
|---|---|---|
| Bebas Neue | `1.0` | All caps, single line, no wrapping |
| DM Sans body | `1.6` | `size × 1.6`: 12.16→19.456, 15.2→24.32, 17.92→28.672 |

The browser shows the CSS-inherited values (e.g. 10.88×1.6=17.408, 11.52×1.6=18.432) — those are the same scale, rounded in the table above.

---

## Color token (mirrors the GitHub palette)

| Token | Hex | Usage |
|---|---|---|
| `--text` | `#EAEAEA` | Primary text (light), links, light-theme text |
| `--text-muted` | `#B9B9C4` | Secondary text, footers, labels |
| `--text-dim` | `#8A8A97` | Small caps labels, hints |
| `--accent` | `#FF7003` | FIRST blue-orange accent, out-of-home, highlights |
| `--badge` | `#6C6C78` | Disabled/muted chips, divider, borders |

Dark theme (default): `bg:#0e0e11`, `panel:#12121a`, `stage:#101018`
Light theme: `bg:#f5f5f6`, `panel:#ffffff`, `stage:#e9e9ee`

---

## Usage rules

- **Never** set `font-family` raw in components; use `--font-display` / `--font-body`.
- **Never** set `font-size` raw; use the scales above.
- All display text must be `text-transform: uppercase` with the matching letter-spacing; the face already has a neutral look, so this is what gives the brand its identity.
- Chips use DM Sans 600 at 12.16 px, `text-transform: uppercase`, `--badge` ink.
- The GitHub `color_palette.md` governs colors; this file governs type only. If the brand adds a third face (e.g. a mono for stats), add it here first.

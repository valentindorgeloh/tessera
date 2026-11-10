# Notion design research (2026-11-10)

Why Notion reads as clean, measured on Notion's own "Projects & Tasks" template (public preview on
notion.notion.site, dark theme, 1440px) and compared with Tessera's work items screen. Facts and measurements
only; nothing is copied from Notion's code. The build that follows from it is the quieter work items screen
(`docs/contracts/ui.md`, "Work items screen").

## Measured

| Part | Notion | Tessera before |
|---|---|---|
| Lines | 1px at about 8% of the text colour, on a cell's bottom and right edge; no outer frame | solid `--color-border` (about 11% equivalent) |
| Column header | 36px, 14px regular, secondary colour, a small property icon, no fill, no sort glyph until used | 29.5px, semibold, sort glyph always at full strength |
| Row | 36px minimum, cell padding 7.5px 8px, 14px/21px regular; the title is medium (500) | 37px table rows, 44px list rows |
| Text levels | primary `rgb(240,239,237)`, secondary `rgb(173,169,163)`, tertiary `rgb(125,122,117)` (10px uppercase footers) | primary and secondary nearly the same in Frappé |
| Properties in a row | plain text, or a borderless tinted pill: 20px, radius 4, padding 0 6px; a status pill is radius 10 with a dot | 24px chips with a 3:1 outline on every property |
| Hover | nothing is drawn until hover; then an "Open" button in the title cell; background eases in 0.1s | every control drawn at rest |
| View bar | one row: view tabs as pills (the active one a 5.5% fill, 32px, radius 20, medium), then icon-only filter, sort and search that open on demand (28px, radius 6) | three stacked rows, a full-width outlined filter field |
| Footer | "Count" in 10px uppercase tertiary with 1px letter spacing | the count as a purple Badge |
| Progress | a 4px track at 10% with an accent fill | none |

## What Notion's people have written

First-party writing on interface craft is thin. What was found:

- Paul Velleux (product designer), "Updating the design of Notion pages", notion.com/blog, 2026: spacing is a
  small set of rules instead of per-block values, and a rule may depend on the neighbour (list items sit closer
  together than paragraphs). Baseline alignment was dropped because user-resized blocks make it unreliable.
- "Databases reimagined: what's changed?", notion.com/help/guides: one "View options" menu holds layout,
  properties, filter, sort and group; views are visible tabs; filter groups moved under "advanced" because they
  were too clunky for daily use; a quick filter stays personal until saved for everyone.
- Ryo Lu (second-hand summaries of talks only): fewer concepts, reused everywhere.
- Nothing by a Notion designer on hover-revealed controls or on colour was found. Those points rest on the
  measurements above.

## Principles for Tessera

1. One line weight, as faint as it can be. Rows are separated by `--color-border-faint`; containers keep `--color-border`; only real inputs keep the 3:1 outline.
2. Chrome appears on intent: hover, focus or an active state. At rest a row is text and pills.
3. Colour belongs to data (state, priority, labels), not to controls.
4. Hierarchy comes from three text levels and weight, not from boxes: the title is medium, properties regular, headers `--color-text-tertiary`.
5. Options live in one menu; the common ones are visible tabs; a filter field shows only while it is used.

## Limits found on the way

- Latte cannot carry a third text level at 4.5:1 (subtext0 is 4.4:1 on base), so `--color-text-tertiary` equals secondary in Latte and steps down only in Frappé.

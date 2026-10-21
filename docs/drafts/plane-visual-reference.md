# Plane visual reference (facts only)

- **Source:** makeplane/plane at commit `4345fb3`, read-only checkout at `/private/tmp/plane`, compiled 2026-10-22 from seven area reports (tokens, shell, issues, timeline, detail, planning, workspace). `/private/tmp` may vanish. It had already vanished when this file was written, so no row was re-verified against source here. Re-check any number before treating it as a hard constraint.
- **Licence rule:** Plane is AGPL-3.0. This file holds facts only: sizes, spacing, alignment and behaviour. It holds no code, no class strings and no component structure. Never copy Plane identifiers into Tessera. Plane colour roles are described in words (for example "hover overlay 4%"), not by their class names.
- **Theme location:** Plane's theme is not in the checkout. `packages/tailwind-config/index.css:16` imports the npm package `@makeplane/propel@0.7.3` (pinned at `pnpm-workspace.yaml:29`). Several reporters read propel's published `dist` read-only from unpkg or jsdelivr through a summarising fetch. Those values are cited as `P:<file>` and have no line numbers. Trust the numbers, but treat the exact recipes as medium confidence.
- **Units:** the px base used is spacing unit = 4px (Tailwind v4 default; neither propel nor Plane overrides `--spacing`), root font 16px (nothing overrides it), so 1rem = 16px. The 4px unit is confirmed by `W/settings/content-wrapper.tsx:33`, whose comment gives 225 units = 56.25rem. Astryx `--spacing-N` uses the same 4px step (`--spacing-1-5` = 6px, `--spacing-11` = 44px), so Plane spacing maps 1:1.
- **Path abbreviations:**
  - `W` = `apps/web/components`
  - `IL` = `W/issues/issue-layouts`
  - `RF` = `W/rich-filters`
  - `B` = `packages/blocks/src`
  - `E` = `packages/editor/src`
  - `TC` = `packages/tailwind-config`
  - `A` = `apps/web/app/(all)/[workspaceSlug]/(projects)`
  - `P` = propel 0.7.3 `dist/`
- **"inferred"** marks a derived value that was not read directly.

## 0. Scale and token map

**Plane state overlays.** These are used everywhere below:
- Hover overlay: black 4% in light, white 5% in dark.
- Pressed overlay: 6% / 7%.
- Selected overlay: 8% / 10%.
- Selection tint on rows: accent at 5%, 10% on hover.

| Element | Plane px | Alignment/state rule | Nearest Astryx token / Tessera rule | Plane source |
|---|---|---|---|---|
| Spacing unit | 4px | 0.5 = 2, 1.5 = 6, 2.5 = 10, 3.5 = 14, 11 = 44 | `--spacing-*` (same 4px step) | `W/settings/content-wrapper.tsx:33` |
| Page gutter (`page-x`, `page-y`) | 21.6px (1.35rem) on both axes | Every row-like strip starts here (header, list rows, cells, filters) | Tessera uses a 16px panel inset, `--spacing-4` (deliberate, see the last section) | P:styles/variables.css (953-956 per planning report); comment at `W/settings/content-wrapper.tsx:33` |
| Header height token | 52px (3.25rem) | Used only by the tabbed project header and the notifications sidebar title | `PanelBar size="header"` 52px (`--size-element-md` + `--spacing-5`) | P:variables.css |
| Font | Inter Variable. Weights: regular 450, medium 500, semibold 600, bold 700, light 350. Mono is IBM Plex Mono. Ligatures off, antialiased. | n/a | Source Sans 3 through `next/font`; weights normal 400, medium 500, semibold 600 | `apps/web/app/root.tsx:30-33,47-53`; `TC/index.css:19-31` |
| Numeric text sizes | text-N = N px (8 to 21, 24, 27, 28, 32, 40). They set no line-height, so they inherit html 1.5: 13px gives 19.5, 11px gives 16.5 (inferred). A legacy comment implies a 20px line for 13px. | 13px (575 uses) and 11px (439 uses) dominate | Body `--font-size-base` 14 with 20px leading (`--text-body-leading` 1.4286); supporting `--font-size-sm` 12 | usage counts; `B/select/select.constants.ts:10` |
| Body roles | Line-height multiplier 1.54: body-md 16/24.6, body-sm 14/21.6, body-xs 13/20.0, body-2xs 12/18.5 | body-xs is the working size for rows and menus | body-xs ≈ `--font-size-base` (14/20); body-sm ≈ base | P:variables.css |
| Caption roles | Line-height multiplier 1.2: caption-md 12/14.4, caption-sm 11/13.2, caption-xs 10/12, caption-2xs 9 | Chips, keys, metadata | `--font-size-sm` (12) | P:variables.css |
| Heading roles | h6 16/1.3, h5 18/1.2 (21.6), h4 20/1.2, h3 24/1.2, h2 28/1.2, h1 32/1.2 | Settings page title is h3-medium (24/500) | `--text-heading-{1..4}`: 24 / 20 / 17 / 14 | P:variables.css |
| Radii | xs 2, sm 4 (468 uses, chips and rows), md 6 (buttons, pills, menu rows), lg 8 (cards, panel), xl 12 (dialogs, rich popover), 2xl 16, 3xl 20 | Control radius: 4 at xs, 6 at sm to lg, 8 at xl and 2xl | `--radius-inner` 4, `--radius-element` 8, `--radius-container` 12, `--radius-page` 16 | P:variables.css:924; usage counts |
| Border widths | Default 1px. Named steps 0.5, 1, 1.5, 2, 2.5. Hairline 0.5px is common in tables, calendar and gantt. | Focus ring 2px | `--border-width` 1px; Astryx hairline | P:variables.css:928-933 |
| Raised shadows | raised-100: 0 1 6 -1 /.03 plus 0 1 4 0 /.04. raised-200: 0 1 2 -1 /.06 plus 0 1 3 0 /.05. raised-300: 0 2 4 -1 /.04 plus 0 4 6 -1 /.05. All rgb(41 47 61). | 100 is for buttons and cards at rest; 200 for card hover and floating menus; 300 for dialogs | `--shadow-low` / `--shadow-med` / `--shadow-high` | P:variables.css:936-949 |
| Overlay shadows | overlay-100: 0 10 10 -5 /.04 plus 0 10 40 -5 /.04. overlay-200: 0 10 10 -10 /.04 plus 0 30 60 -12 /.1. Tailwind's own shadow scale is reset, so plain shadow-sm and shadow-lg render nothing (inferred). | Used on popups and tooltips | `--shadow-high` | P:variables.css |
| Control ladder | xs 20 (padding-x 6, gap 4, glyph 14, radius 4); sm 24 (8 / 4 / 14 / 6); md 28 (10 / 6 / 16 / 6); lg 32 (12 / 6 / 16 / 6); xl 36 (14 / 6 / 16 / 8); 2xl 40 (16 / 8 / 20 / 8). Field inset md 8, lg 10, xl 12, 2xl 14. | md (28) is the workhorse. xs carries a 24px hit halo. | `--size-element-sm` 28, `-md` 32, `-lg` 36; Tessera uses sm controls (28) in headers and rows | P:variables.css (~960-1015); heights confirmed by `B/select/types.ts:28-30` |
| Motion | Default transition 150ms, ease (0.4, 0, 0.2, 1) (inferred). Buttons 200ms ease-out. Popups 150ms, scale from 95%. Panels and sidebar 300ms ease-in-out. Collapsible height 200ms ease-out. Editor 200ms. | Only about 6 reduced-motion rules; no global one | `--duration-fast` 140, `--duration-medium` 280 (Catppuccin), `--ease-standard` | usage counts; `E/styles/variables.css:227` |
| Breakpoints | sm 640, md 768, lg 1024, xl 1280, 2xl 1536. Container `@4xl` = 896. Settings container 943.2px. JS gate at 768. A `3xl` step is used but undefined, so it does nothing (inferred). | Header actions hide below md; list rows stack below lg | Astryx responsive props; Tessera checks at 375 and 1100 | P (none overridden); `W/settings/content-wrapper.tsx:33` |
| Z layers | Content 1-5; sticky headers 10-12; sidebar, peek and scrim 20; extended sidebar 21; peek 25; top bar 27; search 30; overlays 40-50; popup positioner 50; nested submenu 70 | n/a | Astryx layering (not tokenised in app CSS) | `W/sidebar/resizable-sidebar.tsx:183`; `B/select/types.ts:234` |
| Focus ring | No token. Buttons: 2px accent ring, 1px offset. Fields: accent border plus 2px ring at accent/20. Tabs: 2px inset ring. Breadcrumbs: 2px inset outline. Sidebar links, list rows and tab links have no custom ring (outline removed). | n/a | `--focus-outline-width` 2, `--focus-outline-offset` 3, `--focus-outline-color` accent | `B/select/utils.ts:144-146`; `W/common/breadcrumb-link.tsx:81`; P:internal/control-chrome.js |
| Disabled | Muted text and a not-allowed cursor. Fields keep their surface and lose the ring. Menu rows go to 50% opacity. Admin-only settings pages go to 60% opacity. | n/a | `--color-text-disabled`; Astryx `isDisabled` | `B/select/utils.ts:149-151`; `apps/web/styles/power-k.css:20-27` |
| Scrollbars | Hidden by default and opt-in per region. Box sizes: xs 10, sm 12, md 14, lg 16, with a 3px transparent border (4px at lg) and a full-round thumb. Firefox uses a thin bar at 0.1, 0.25 and 0.7 alpha. Propel ScrollArea fades in over 150ms. | Lists use lg (16), menus use sm (12) | Astryx `ScrollArea` / native | `TC/index.css:64-209` |

## 1. Shell

| Element | Plane px | Alignment/state rule | Nearest Astryx token / Tessera rule | Plane source |
|---|---|---|---|---|
| App frame | Canvas around one white panel. Panel inset 8px left, right and bottom, 0 top. Panel radius 8, 1px subtle border. | Sidebar and main are the same white, split only by the sidebar's 1px right border | `AppShell variant="wash" contentPadding={2}`: 8px on every side, radius `--radius-page` 16 | `A/layout.tsx:18,20,23`; `W/workspace/content-wrapper.tsx:29-33` |
| App rail | 60px (48 icon-only). Off in CE, so there is no collapsed rail. | Collapsed sidebar = width 0 | No rail | `lib/app-rail/provider.tsx:26,40` |
| Top bar | Min height 40, inline padding 14 (8 when labels are off). Sits on the canvas with no border. | Three columns; both flanks flex, so search stays centred | `TopNav` on the wash | `W/navigation/top-navigation-root.tsx:49` |
| Workspace trigger | About 36 high, 4px padding, radius 4, max width 192. Logo tile 28 (radius 6, 1px border). Name 14/500. Chevron 16, turns 180° over 300ms. | Hover and open: layer-1 fill. Menu 304px wide. | Brand tile → `/home` | `W/workspace/sidebar/workspace-menu-root.tsx:79-142` |
| Search field | 28 high, radius 8, 1px border, 8px padding. Width 364 closed and 554 open, animated over 300ms. Icon 14, 8px gap. Text 13. | Dropdown is 574 wide, 6px above the field, radius 6, 40px top padding, max height 80vh. No narrow collapse. | `tessera-topbar-search` ≈ 364, sm; opens Power K instead of growing | `W/navigation/top-nav-power-k.tsx:212-272` |
| Top-bar icon buttons | 32 box, radius 6, 20px icon, 4px gap between them | Rest: tertiary icon. Hover: hover overlay and secondary icon. Active: selected overlay and primary icon. Unread dot 8px, top right. | Ghost `IconButton` | `W/sidebar/sidebar-item.tsx:58-61`; `top-navigation-root.tsx:72` |
| Avatar trigger | 32 box, 20px avatar | User menu 288 wide, with a 116px cover | `Avatar` in a ghost `IconButton` | `top-navigation-root.tsx:82`; `user-menu-root.tsx:86-87` |
| Sidebar width | Default 250, min 236, max 350, persisted. Resize handle 4px (6px while dragging), double-click collapses. Collapse runs 300ms. | Below 768 it collapses on load, on outside click and on nav click | Same 236-350 / 250 (`tessera.sidebarWidth.v1`) | `packages/constants/src/sidebar.ts:7`; `W/sidebar/resizable-sidebar.tsx:44-213` |
| Sidebar top block | 12px gutter, 12px gap. Title row has 8px padding (title at x = 20). Title 16/500. | Actions are 24px ghost icon buttons | Heading "Work" | `W/sidebar/sidebar-wrapper.tsx:58-62` |
| Quick-action button | 32 high, full width, 12px padding, radius 6, strong border, raised-100. Icon 16, label 13/500, label max width 145. | Hover and pressed fills; focus 2px ring, 1px offset; disabled is flat | Quiet secondary sm "New work item" | `add-button.tsx:17`; `quick-actions.tsx:84-85` |
| Sidebar scroll region | Sections 12 apart, gutter 12, top padding 12 | Order: nav, Workspace, Favorites, Projects | `SideNav` | `sidebar-wrapper.tsx:80-81` |
| Sidebar footer | 48 high, top border, 12px padding, 28px button | n/a | n/a | `sidebar-wrapper.tsx:84` |
| Nav row | 30 high: 4 + 1 + 20 + 1 + 4. Padding 8px inline, 4px block. Gap 6, radius 6, icon 16, text 13/500 on a 20px line. Pitch 32 (2px gap). | Icon left edge is 8px into the row, the same x as section-header text. Label at x = 30. Rest secondary; hover 4%; pressed and current 6%; current text primary; weight never changes. | Astryx `SideNav` item | `W/sidebar/sidebar-navigation.tsx:20-23`; `W/workspace/sidebar/sidebar-item.tsx:73-75` |
| Section header | Trigger 32 high, 8px inline padding, radius 8. Title 13/600 in placeholder colour. Chevron 14. "+" button 20 (glyph 14), shown only on hover or focus-within. | Panel height animates 200ms. A border appears on top when the list scrolls. | `SideNav` section with "+" | `sidebar-menu-items.tsx:103-110`; `projects-list.tsx:169-197` |
| Project row | About 32 high (inferred): 8px inline, 6px block padding, radius 6. Logo 16, gap 6, label 13/500. Pitch 34. | "…" button 20px, hidden but keeping its space until hover. Current route: pressed overlay. Menu open: surface-2. | Flat project rows: logo, name, count; current one selected | `W/workspace/sidebar/projects-list-item.tsx:302-365` |
| Project drag | Handle 12px outside the row, inside the gutter. 14px grip with 2px padding. | Dragged row at 60% on layer-1. Drop line 2px accent with 6px square caps. Preview: radius 4, 4px padding, 13px text. | `use-pointer-drag` | `projects-list-item.tsx:170,295,319`; `B/common/drop-indicator.tsx` |
| Nested project items (accordion) | Indent 24, 4px above, 6px below, 2px gap. Text 11/500, about 26.5 high (inferred). | 1px guide line at x = 15, through the 16px logo's centre. Active: pressed overlay. | Not used: Tessera puts project pages in header tabs | `projects-list-item.tsx:448-449`; `project-navigation.tsx:196-203` |
| Extended sidebar | 300 wide, 16px / 8px padding, beside the sidebar | Search field 32 high | n/a | `extended-sidebar-wrapper.tsx:47-56` |

## 2. Content headers, breadcrumbs, tabs

| Element | Plane px | Alignment/state rule | Nearest Astryx token / Tessera rule | Plane source |
|---|---|---|---|---|
| Page header | 44 high, 1px bottom border, inline padding 21.6, 8px gap. Right group gap 8. Left group max 80% width. | 28px buttons sit 8px from top and bottom; 24px crumbs sit 10px | `PanelBar size="subheader"` 44, 16px inline padding | `W/core/app-header.tsx:27`; `B/layout/header/helper.tsx:17-32` |
| Secondary header | Min height 52, 1px bottom border, inline 21.6, no block padding | Holds tab strips (pages, inbox, notifications, profile) | `PanelBar size="header"` 52 | `B/layout/header/helper.tsx:18-26` |
| Filters header | Block padding 8, bottom border, 8px gap, wraps | Height = chips + 16 | `PanelBar size="filters" hasDivider` 44 | same |
| Header responsive | Filters, display and analytics hidden below 768. Layout switch full at a container ≥896, compact dropdown below. Primary label short below 640. | Mobile bar below 768: three equal cells split by borders, 8px block padding | `canWrap` drops the end group under the title | `W/issues/header.tsx:113-132`; `W/issues/filters.tsx:97-141`; `mobile-header.tsx:71` |
| Breadcrumb pill | 24 high, 4px inline padding, gap 6, radius 6. Text 13/500. Icon 16. Label max 150, truncated. Separator: 24px cell with a 14px chevron. | Rest tertiary; hover 4%; current primary with no hover. Label at x = 26 inside the pill. At ≤640px viewport everything but the last crumb folds into an ellipsis menu. | Detail breadcrumbs; `PanelTitle` 14/500 | `B/breadcrumb/breadcrumbs.tsx:30,120,139,309`; P:elements/breadcrumb |
| Count chip | Radius 12, padding 10 × 2, 11/600, accent text on accent/20 | 10px from the crumbs | Purple `Badge` | `W/common/count-chip.tsx:19` |
| Tabbed project header (option, not default) | 52 high, inline 21.6, 12px between groups. Divider is 1px wide, 20px tall. Switcher tile 28 with a 16px logo; name 14/500, max 192. | Tabs pulled 12px down so the indicator lands near the border (≈3px above it, inferred) | Tessera's default: 52px `PanelBar` with token, name, divider and `TabList size="sm"` docked on the hairline | `A/projects/(detail)/[projectId]/layout.tsx:34-48`; `W/navigation/tab-navigation-root.tsx:179-199` |
| Underline tab | Label 28 high, 8px inline padding, radius 6, 14/500. 8px gap to a 3px bar inset 8px each side. Total 39. Tabs 1px apart. | Rest tertiary; hover 4% and secondary; pressed 6%; selected 8% and primary. Indicator slides over 150ms. Focus: 2px inset ring. | `TabList` underline (caps rounded, allowed) | P:elements/tabs |
| Tab overflow | Measured with ResizeObserver, 4px gap, 40px "more" button. The active tab is swapped into the last visible slot. | Right-click menu offers "Set as default" and "Hide" | Tabs scroll in the remaining space | `use-responsive-tab-layout.ts:48-148` |
| Contained tabs | Strip radius 8, 2px padding, 1px gap. Tab 24 high, 6px inline padding, radius 6, 13/500. Strip total 28. | Active tab: layer-2 fill, subtle border, raised-200 | `SegmentedControl` | P:elements/tabs |
| Page-strip tabs | Full-height link, 16px inline padding, 13/500. Active: accent text and a 2px bar flush with the header's bottom border. | Inactive bar transparent, so height stays fixed | Archives tabs pulled in 12px | `W/pages/list/tab-navigation.tsx:43-65` |
| Collapsed-sidebar toggle | 24px ghost icon button at the start of the header | 8px gap | Sidebar button in the top bar | `W/common/extended-app-header.tsx:29` |
| Page body | Always reserves a scrollbar lane. Pages pad 21.6 / 21.6. | n/a | `LayoutContent` | `W/core/content-wrapper.tsx:17-19` |

## 3. Command palette (Power K)

| Element | Plane px | Alignment/state rule | Nearest Astryx token / Tessera rule | Plane source |
|---|---|---|---|---|
| Dialog | 672 wide, max 100vw − 32, max height 100dvh − 160. Sits 80px from the top. Radius 12, 1px border, raised-300. | Enter and exit: scale 95% and fade, 200ms | `CommandBar` | `W/power-k/ui/modal/wrapper.tsx:134`; P:elements/dialog |
| Search row | Padding 16 × 12, gap 8, 16px icon, 13px input, bottom border | Clear button 12px with 4px padding | n/a | `header.tsx:34-58` |
| Context chip | Wrapper padding 16 / 12 / 8. Chip radius 4, 11/500, close 10. | n/a | n/a | `context-indicator.tsx:32-34` |
| Group heading | 12/500 tertiary, 7.2px inline padding, 8px below | n/a | n/a | `apps/web/styles/power-k.css:2-9` |
| Item | 36 high: 8px padding plus a 20px line. Radius 6, icon 14, gap 8, label secondary, check 12. List max height 384. | Selected or keyboard-focused: 6% overlay. Disabled 50%. | Astryx command item | `power-k.css:10-25`; `command-item.tsx:56` |
| Shortcut badge | 20 high, radius 4, strong border, 6px inline padding, mono 10/500 | 4px between keys | `Kbd` | `command-item-shortcut-badge.tsx:79,104` |
| Footer | Top border, surface-2 at 80%, padding 16 × 8, caption 11 | n/a | n/a | `footer.tsx:24-27` |

## 4. Shared primitives (menus, popovers, buttons, fields)

| Element | Plane px | Alignment/state rule | Nearest Astryx token / Tessera rule | Plane source |
|---|---|---|---|---|
| Menu popup | 4px padding, radius 8, 1px border, overlay shadow. Width 192 to 384. Max height 288; inner list 240. | Opens with scale and fade, 150ms | Astryx `Menu` (12px around 8px rows at a 4px inset, per ui.md) | P:internal/popup-surface; `B/select/menu-parts.tsx:35,48-51`; `virtual-list-body.tsx:285` |
| Menu row | 28 high (two-line rows: 6px block padding), 8px inline, gap 6, radius 6, 13/450, glyph 16 | Highlight 4%; danger rows recolour the text only | `MenuItem` | P:internal/menu-row-parts:46-64; `B/select/select.constants.ts:13` |
| Menu label / separator / group heading | Label: min 24 high, 8px inline, 12/500 tertiary. Separator: 1px with 4px above and below, bleeding 4px each side. Group heading: 8 × 6 padding, 12/500. | n/a | Menu section | P:menu variants; `B/select/virtual-list-body.tsx:43` |
| Tooltip | Single-line: radius 6, 12px, padding 8 × 6, 1px border, layer-2 fill, overlay-200, 8px arrow. Stacked: max 500 wide, radius 8, 13px. | Disabled on mobile | `Tooltip` | P:tooltip |
| Button | xs 20, sm 24, md 28 (min width 48, padding 10, gap 6, 13/500), lg 32 | Secondary: strong border, layer-2 fill, raised-100. Primary: accent fill. Hover and pressed: one fill step each. Focus: 2px accent ring, 1px offset. Disabled secondary: subtle border, transparent, no shadow. 200ms ease-out. | `Button size="sm"` (28) in rows and headers | P:elements/button; P:internal/button-geometry; P:internal/control-chrome |
| Icon button | Square at the control height: 20, 24, 28 or 32. Radius 4 / 6 / 6 / 6. Glyph 14 / 14 / 16 / 16. | Same chrome as buttons | `IconButton` | P |
| Input | md 28 (inset 8, 13px), lg 32 (10, 14px), xl 36, 2xl 40 (14, 16px, radius 8). 1px subtle border, layer-2 fill. | Hover: strong border. Focus-within: accent border plus 2px ring at 20%. Invalid: danger border and ring. Disabled: keeps its surface, loses ring and hover. | `TextInput`; control outline `--color-border-emphasized` | P:elements/input; `B/select/utils.ts:144-151` |
| Textarea | lg: 13px, min height 76, padding 12 × 8. The inline variant has no frame. | n/a | `TextArea` | P:elements/text-area |
| Ghost select (property value) | Min height 28, 13px, glyph 16, gap 6, radius 6, padding 8, transparent border | Hover 4%; open and focus 6%; chevron shown only on hover or focus | Ghost `Selector` | `B/select/utils.ts:157-176` |
| Pill trigger | sm 20 (padding 6 × 4, 12px, icon 14); md 24 (13px, icon 14); lg 28 (8 × 4, 14px, icon 16). Gap 4, radius 6, 1px subtle border, layer-2 fill. | Hover: strong border and fill step. Pressed: next step. Disabled: transparent. No visible focus ring (inferred). | Row chips: 24px, emphasized outline, `--radius-inner` | `B/pill-button/helper.tsx:10-24` |
| Switch | sm 23 × 14, thumb 12, travel 9, 100ms. md 27 × 16. lg 30 × 18. | Off: placeholder-colour track. On: accent. Focus ring offset 2. | `Switch` (off track uses the emphasized outline) | P:elements/switch |
| Checkbox | 16px hit area, 14px painted box, radius 4 | Label row: gap 8, padding 8 × 4, 13px | `Checkbox` | P:internal/checkbox-box |
| Avatar | 2xs 16, xs 20, sm 24, md 28, lg 32, xl 40, 2xl 56, 3xl 64. 1px border (2px from xl up). | n/a | `Avatar` | P:internal/avatar-shared |
| Linear progress | md 8 high, sm 5. Full radius, layer-3-selected track, 300ms width animation. | n/a | `ProgressBar` | P:elements/linear-progress |
| Table (propel) | Frame radius 8, 1px border, 13px text. Head cell 44 high, padding 12 × 8, 12/600 tertiary. Body cell min 44, 0.5px bottom border, cell gap 6. | Row hover 4%; selected 8% | Astryx `Table` | P:elements/table; `W/common/data-table.tsx:25` |
| Collapsible (inline) | Trigger padding 12 × 8 (≈37.6 high, inferred), gap 8, 14/500, glyph 16. Trailing slot 12px from the end. Panel padding 12 inline, 6 top, 12 bottom. | Chevron −90° closed to 0° open, 200ms. No hover fill. Focus: 2px ring. | `Collapsible` | P:components/collapsible |
| Dialog | Widths: xs 480, sm 576, md 672, lg 800, xl 1000; fixed height 700. Viewport padding 16 × 80. Radius 12, raised-300. Gutters 16, main gap 16, title 18/500. Close: tertiary sm icon button. | Footer: buttons md, right-aligned, 8px gap | Dialog from `@/components/shell/dialogs`, `--radius-container` | P:elements/dialog |
| Drag handle / drop line | Handle: 14px grip with 2px padding (18 total), radius 4. Drop line: 2px accent with 6 × 6 end caps. | Grab cursor | DnD reducer | `B/common/drag-handle.tsx:33`; `B/common/drop-indicator.tsx:21` |
| Favourite star | 16 × 16 button with a 16px star | Outline when off, yellow fill when on, crossfade | n/a | `B/common/favorite-star.tsx:29` |

## 5. Work items: list layout

| Element | Plane px | Alignment/state rule | Nearest Astryx token / Tessera rule | Plane source |
|---|---|---|---|---|
| Group header | ≈44 plus a 1px border (inferred). Block padding 4 outer and 6 inner. Inline 21.6 start, 12 end. Layer-1 band. | Sticky while the group is expanded and non-empty. Hover: layer-1-hover. | 40px muted band, sticky `Collapsible` trigger | `IL/list/list-group.tsx:267`; `IL/list/headers/group-by-card.tsx:96` |
| Group title / count / icon | Title inherits 16/500 (inferred). Count 13/500 tertiary with 8px before it. Icon 14. | Group icon x = 21.6, the same as the row key | `Badge` with the count | `group-by-card.tsx:114-123` |
| Group "+" | 20 × 20, radius 2, icon 14 | In a cycle or module scope it opens a menu (new or existing) | n/a | `group-by-card.tsx:134,159` |
| Group checkbox | At x = 4, 14px slot | Hidden until header hover; shown once any child is selected | n/a | `group-by-card.tsx:98-110` |
| Row | Min height 44 (12 + 20 + 12). Block padding 12, gap 12, 13px. Bottom border 1px (none on the last row). | Hover 4%. Selected: accent 5% (10% on hover). Dragging: layer-1. The peek border has no width, so it is invisible (inferred). | Rows ≥44 | `IL/list/block.tsx:183`; `IL/list/block-root.tsx:139` |
| Row responsive | Stacked (title line, then properties, 12px gap) below lg (1024) with the sidebar open, or below md (768) with it collapsed. Single line above. | The same breakpoint moves quick actions inline | Label slot min `min(14rem, 100%)`; properties wrap to a second line | `block.tsx:189-190` |
| Row checkbox | Absolute at x = 4, 14px slot, 16px box | Hidden until row hover or selection | Tessera: in-flow checkbox, row start inset 12 | `block.tsx:216-224` |
| Key | Min width = (identifier length + sequence digits) × 7 + 7 px. Text 11/450 or 12/500, tertiary (merge unresolved). | Keys line up across rows | Supporting size, secondary, tabular | `block.tsx:159,233`; `IL/utils.tsx:813-816`; `W/issues/issue-detail/identifier-text.tsx` |
| Sub-item chevron | 16 slot, always reserved, turns 90° | Keeps titles aligned. Gaps: 4px in the key cluster, 2px to the title. | n/a | `block.tsx:207-262` |
| Title | 13/500 on a 20px line, one line with ellipsis, tooltip | x = 21.6 + key + 4 + 16 + 2 | `RowTitle` (medium, one line) | `block.tsx:269` |
| Sub-item indent | 14 at top level, +12 per level | At depth ≥3 the chevron opens the peek instead | n/a | `block-root.tsx:61,156` |
| Properties cluster | Gap 8, wraps | Chip centres sit on the title midline | `.tessera-wi-props`; end inset 16 | `block.tsx:296-300` |
| Quick add (list) | Closed ≈43.5 (12 + 19.5 + 12): 21.6 inline, gap 8, 14 icon, 13/500. Sticky at the bottom with top and bottom borders. Open: 44px input, 13/500 on a 20px line; hint 11 italic. | Esc and outside click close it; Enter submits; autofocus | Inline quick-add row | `IL/quick-add/*` |
| Load more (grouped) | 44 high, 32px start padding, 13/500 accent | n/a | `GroupFooter` ghost sm | `list-group.tsx:136` |
| Drop feedback | 2px line with 6px dots. After a drop: 1px accent border, or a 5px left accent bar on layer-2. Removed on outside click. | n/a | n/a | `TC/index.css:212-219`; `IL/list/block-root.tsx:131,185` |
| Group drag overlay | Layer-1 at 85%, radius 4, strong border, 13/500 message box | Danger tint when the drop is not allowed | n/a | `IL/group-drag-overlay.tsx:51-66` |

## 6. Work items: property chips

| Element | Plane px | Alignment/state rule | Nearest Astryx token / Tessera rule | Plane source |
|---|---|---|---|---|
| Chip slot | 20 high | Order: state, priority, dates, assignees, modules, cycle, estimate, sub-items, attachments, links, labels | 24px chips | `IL/properties/all-properties.tsx:212-390` |
| Pill chip | pill-sm: 20 high, 6px inline padding, gap 4, radius 6, 1px subtle border, 12/450, icon 14, max width 160 | See pill trigger states | Emphasized outline, `--radius-inner`, supporting size, no chevron | `B/pill-button/helper.ts`; `B/select/trigger-chrome.tsx:147` |
| Date chip | Icon plus date; an icon alone when empty. Ranges merge shared parts ("Jun 10 - 24, 2025"). | Overdue in danger text | `formatShortDate` | `date-range-select.tsx:30-76` |
| Assignees | Keeps the 20px footprint with no frame. Faces 20px, up to 3, then "+N". | Empty: pill with a placeholder | `AvatarGroup` | `member-select.tsx:44-85` |
| Label chip | One label: 8px dot plus name. Several: first dot plus "N labels". | n/a | `Token` | `label-select.tsx:162-178` |
| Count chips | 20 high, 10px inline padding, gap 8, radius 4, 0.5px strong border, icon 12, 11px | Sub-item chip is clickable when the count is above 0 | n/a | `all-properties.tsx:410-457` |

## 7. Work items: board (kanban)

| Element | Plane px | Alignment/state rule | Nearest Astryx token / Tessera rule | Plane source |
|---|---|---|---|---|
| Strip | Inline padding 21.6, 8 top, 0 bottom. 16px column gap on a surface-2 backdrop. 16px scrollbar. | Scrolls horizontally at every width; no stacking | 16px gaps on a muted backdrop | `IL/kanban/default.tsx:147`; `IL/kanban/base-kanban-root.tsx:222-226` |
| Column | Fixed 350 wide. Collapsed: 44 wide with a vertical label, max height 400. | Body min height 120. While dragging over: radius 4, layer-1. Column scrollbar 14. | `min(350px, 100cqw)`; snaps below 480 | `default.tsx:164-169`; `IL/kanban/kanban-group.tsx:284-290` |
| Column header | Sticky, ≈44 high (inferred). Icon box 20 (icon 14). Title 16/500 (inferred). Count 13/500 tertiary. Collapse and "+" buttons 20, radius 4. | Title row baseline-aligned | n/a | `IL/kanban/headers/group-by-card.tsx:114-185` |
| Card | Radius 8, 1px subtle border, layer-2 fill, padding 12, raised-100, 8px apart. Inner stack gap 8. | Hover: strong border and raised-200. Peeked: accent border. Dragging: layer-1. | 8px cards with 12px padding; columns concentric (16px) | `IL/kanban/block.tsx:249-277` |
| Card key row | Key 11 or 12. Menu button 4px above the top, at the right, shown on hover (always on mobile). | n/a | n/a | `block.tsx:100-123` |
| Card title | 14/500 on a 21.6 line, one line | n/a | n/a | `block.tsx:127` |
| Card properties | 6px above, gap 8, wraps, chips 20 | n/a | n/a | `block.tsx:133` |
| Swimlanes | Top row 50 high, sticky. Lane bar sticky at 50px, 0.5px top and bottom borders, layer-1. Lane header: 20px chevron and icon boxes, title 13. | Lane columns line up with the top row (350 + 16) | Sub-groups as swimlanes | `IL/kanban/swimlanes.tsx:75-310`; `sub-group-by-card.tsx:29-46` |
| Delete drop zone | Fixed at top centre, 288 wide, 12px from the top. 2px danger border, 11 italic. | Fades in over 300ms while dragging | n/a | `kanban-delete-drop-zone.tsx:51-60` |
| Quick add (board) | Closed: radius 8, padding 8 × 6. Open: card with radius 4, 4px margin, padding 12, raised-200; hint strip on layer-3. | n/a | n/a | `IL/quick-add/*` |

## 8. Work items: spreadsheet (table)

| Element | Plane px | Alignment/state rule | Nearest Astryx token / Tessera rule | Plane source |
|---|---|---|---|---|
| Header row | 44 high, sticky, 0.5px bottom border | n/a | Astryx `Table` head | `IL/spreadsheet/spreadsheet-header.tsx:50-75` |
| First column | Min width 240 (360 without the key); cell max 512. Header content min 320 plus 43.2 of padding. | Sticky only at ≥768. While scrolled sideways it casts a shadow of 8 22 22 10 black at 5%. | First column text on the 16px inset | `spreadsheet-header.tsx:54`; `issue-row.tsx:267-307` |
| Body cell | 44 high, 0.5px bottom border, 1px right border, 13px | n/a | Astryx `Table` cell | `issue-column.tsx:49`; `issue-row.tsx:267-285` |
| Key / title | Key column min 96, 11px. Title 13, 16px end padding. Indent 6, +12 per level. | Quick actions fade in on hover | Key header and key text start at the same x | `issue-row.tsx:288-358` |
| Property header | Min 144 wide, 13/500, inline 21.6, icon 16, gap 6. Sort glyph 12 with 12px before it. | Hover: primary text | `useTableSortable` | `IL/spreadsheet/columns/header-column.tsx:62-85` |
| Cell trigger | Inline padding 21.6, 12px text on a 16px line, gap 4, square corners, full cell height | Hover 4%, open 6%. Header text, cell text and first-column text share the 21.6 inset. | Ghost controls through `renderCell` | `B/select/utils.ts:~96-112` |
| Row states | Selected: accent 5%, 10% on hover. Peeked first cell: 1px accent border. | Cells take Tab focus; Enter or Space clicks | n/a | `issue-row.tsx:97-103` |
| Quick add (table) | Closed: padding 8, gap 6. Open: key 80 wide, 20px gap, input with 12px block padding. | n/a | n/a | `IL/quick-add/*` |

## 9. Work items: filters, display, layout switch, empty

| Element | Plane px | Alignment/state rule | Nearest Astryx token / Tessera rule | Plane source |
|---|---|---|---|---|
| Layout switch | Container radius 6, layer-3, padding and gap 4, 30 high. Buttons 22 × 28, radius 4, icon 14. | Hover 4%; selected 6% with primary icon. Below a 896px container: a 24px dropdown. | `LayoutSwitch`: icon-only sm `SegmentedControl` | `IL/filters/header/layout-selection.tsx:35-55`; `mobile-layout-selection.tsx` |
| Display trigger | Secondary md (28): 13/500, glyph 16. Icon-only below 896. Applied dot 8px, 2px outside the corner. | n/a | Display `Popover` trigger | `IL/filters/header/helpers/dropdown.tsx:~55-95` |
| Display popover | Outer: radius 12, padding 16, min 320, layer-2, overlay-200. Inner: 300 wide, max height 480 (600 from 1024). | Sections padded 10 inline and 8 block, with dividers | `Popover` with `Selector`s | `dropdown.tsx:~100-108`; `display-filters-selection.tsx:53-119` |
| Display option row | ≈25 high: padding 6, radius 4, gap 8, 11px secondary. Check box 12 (round for single choice, radius 2 for multi); tick 10. | Hover 4%; checked accent fill | n/a | `IL/filters/header/helpers/filter-option.tsx` |
| Display-property chips | ≈22.5 high: radius 4, padding 8 × 2, 11px, gap 8 | Off: subtle border. On: accent fill. | n/a | `display-properties.tsx:~66-80` |
| Filter row | Min 44, padding 12 × 8. Inner band: radius 8, layer-1, padding 16 × 8, chip gap 8. Actions: 16px after a divider. | Buttons sm (24) | `PowerSearch` in the filters row | `RF/filters-row.tsx:~118-130` |
| Filter chip | 28 high, radius 4, 1px border. Segments flush, split by 1px borders. Property: 8 × 5, 11px, icon 14. Operator and value: inset 8, 13px. Close: 6px padding, icon 14. Multi-value names max 96 each. | Error: danger border. Enters with scale and fade over 200ms. | `PowerSearch` token | `RF/filter-item/container.tsx:51-53`; `property.tsx:47-58`; `root.tsx:79-92`; `close-button.tsx:22-26` |
| Applied-filter chip (cycles, pages) | Min 36, radius 6, 1px border, padding 6, gap 6, 11px | Inner tags radius 4, padding 6 × 4. Remove icon 10 or 12. | n/a | `W/cycles/applied-filters/root.tsx:46-80` |
| Detailed empty state | Max 400 wide, 24px gap, left-aligned. Asset max 160. Title 16/600 on a 28 line; text 13 on a 20 line. Buttons lg (32), stacked below 640. | Filters active with no match: search asset and "clear filters" | `NoResults` / `EmptyState` | `B/empty-state/detailed-empty-state.tsx:45-85` |
| Compact empty state | Centred, 12px gap, asset 80 (often), buttons sm (24) | Hosted on a layer-1 strip (radius 8, 40px block padding) | `EmptyState` | `B/empty-state/compact-empty-state.tsx:47-83` |

## 10. Calendar

| Element | Plane px | Alignment/state rule | Nearest Astryx token / Tessera rule | Plane source |
|---|---|---|---|---|
| Root | 16 top padding. Grid rows split by 0.5px rules. Columns split by 0.5px rules only from 768. | Header and grid scroll together; the weekday row is sticky | `CalendarLayout` | `IL/calendar/base-calendar-root.tsx:160`; `calendar.tsx:146-155`; `week-days.tsx:87-91` |
| Nav header | Inline 21.6, 16 below, gap 6. Prev and next are bare 16px icons (16px hit area). Title 18/600. Today: radius 4, padding 10 × 4, 11/500. | Month steps by a month; week steps by 7 days; Today jumps and selects today. Week title shows a range ("Oct - Nov 2026"). | n/a | `IL/calendar/header.tsx:44-123`; `months-dropdown.tsx:34-68` |
| Options trigger | Radius 4, layer-1, padding 10 × 4, 11px, chevron 12. A 16px kebab below 768. | Menu: Month or Week (radio), then a separator, then "Show weekends" (check) | n/a | `options-dropdown.tsx:98-134` |
| Month picker | 224 wide. 4-column grid with 16px gaps. Month buttons radius 4, 11px. | n/a | n/a | `months-dropdown.tsx:77-116` |
| Weekday row | 44 high, layer-1, 16px inline padding, 13/500. Centred below 768, right-aligned from 768. | Weekday label sits 16px from the right edge; date numbers sit 8px from it, so they are offset by 8 (Plane quirk) | Week start follows the workspace setting | `IL/calendar/week-header.tsx:30-46` |
| Day header | 8 × 6 padding, right-aligned, 11px. ≈28 high, 32 with the today pill. Today: 20px filled accent circle. First of month: "Nov 1". | Outside the month: tertiary, regular weight. Inside: medium. Weekend: layer-1 tint. | n/a | `IL/calendar/day-tile.tsx:147-178` |
| Day body | Month view: min height 80. Week view: stretches to full height. | Drag-over: 70% opacity and a hover tint on weekdays | n/a | `day-tile.tsx:171-178` |
| Item chip | 32 high (40 below 768). 4 × 8 gutter around it, radius 4, 4px inline padding, gap 6. Full 1px border from 768, bottom border only below. 2px full-height state bar. Title 11 (13/500 below 768). | Hover: surface-2 and a darker border. Peeked: accent border. Dragging: accent border, surface-2, raised-200. After a drop: 1px accent highlight. Menu slot 20, shown on hover. | n/a | `IL/calendar/issue-block.tsx:101-175`; `issue-blocks.tsx:74` |
| Day overflow | No "+N more". The cell grows. Server paging adds "Load more": 11/500 accent, padding 6 × 4. | Quick add appears on cell hover at ≥768 and is always shown below | n/a | `issue-blocks.tsx:85-114`; `quick-add-issue-actions.tsx:114-117` |
| Weekends | Hidden by default (5 columns). Shown: 7 columns, weekends tinted. | Rows: 4 to 6 per month | n/a | `week-days.tsx:73` |
| Narrow (<768) | Tiles shrink to 24px date circles. The selected day's items list below the grid (16 padding, heading 18/600). Drag is off. | Selected: accent fill. Today: accent 10% tint. | n/a | `day-tile.tsx`; `calendar.tsx:207-258` |

## 11. Gantt

| Element | Plane px | Alignment/state rule | Nearest Astryx token / Tessera rule | Plane source |
|---|---|---|---|---|
| Constants | Row 44. Header 48 (bands of 28 and 20). Toolbar 40. Sidebar 360. Undated block 60. | Sidebar rows and chart rows share the 44 grid; the chart body sits 48 down | `GanttLayout` | `W/gantt-chart/constants.ts:7-15` |
| Zoom | Day width: week 60, month 20, quarter 5. Default is week. | Switching zoom recentres on today | Gantt zoom | `W/gantt-chart/data/index.ts:84-106` |
| Toolbar | 40 high, 8 block padding, inline 21.6, gap 8, wraps. Count 11/500 tertiary pushed to the end. Zoom buttons radius 6, padding 8 × 4, 11px. Full-screen button ≈26 square. | Selected zoom: 8% overlay plus pressed state | n/a | `W/gantt-chart/chart/header.tsx:40-88` |
| Sidebar | 360 fixed (no resize), sticky left, 0.5px right border. Header 48, bottom-aligned with 8px below, 13/500 tertiary, 16 end padding. | Rows have no borders. Hover syncs with the chart row. Selected: accent 5%. | n/a | `W/gantt-chart/sidebar/root.tsx:56-106` |
| Sidebar row | 44, gap 8, 16 end padding. Key, 8px, name 13/500. Duration 13 secondary ("N days"). | Reorder only when sorted manually; otherwise a toast. Drop line 2px. | n/a | `W/gantt-chart/sidebar/issues/block.tsx:46-95` |
| Header bands | Top band 28: label 13 (week view) or 14 (month and quarter), sticky at x = 360. Bottom band 20: cells 11/500. 0.25px outlines. | Today: accent 20% column tint, filled date pill, "Current" badge 9/500. No vertical today line. | n/a | `W/gantt-chart/chart/views/{week,month,quarter}.tsx` |
| Weekend shading | Week view only: surface-2 columns | n/a | n/a | `views/week.tsx` |
| Bar | 32 high in the 44 row (6 above and below, inferred). Radius 4. Width = inclusive days × day width; minimum 1 day; snaps to days. | Fill: state colour washed 50% toward the surface. One-sided dates fade out with a gradient. The label (13, 10px padding) stays sticky at x = 360. | n/a | `W/gantt-chart/helpers/draggable.tsx:42,51`; `IL/gantt/blocks.tsx:67-80`; `IL/utils.tsx:740-747` |
| Resize handle | Hit area 12 wide, row height, 6px outside the bar edge. Grip 4 × 28, 2px radius, fades in over 300ms (likely hidden under the fill when idle, inferred). | While dragging, a date chip shows 16px outside the bar | n/a | `helpers/blockResizables/left-resizable.tsx:45-64` |
| Off-screen / add-dates buttons | 32 square, radius 4, strong border, icon 14. Off-screen button sits at x = 364. | Add-dates follows the pointer; a click sets start and start + 1 day | n/a | `helpers/add-block.tsx:31-48` |
| Auto-scroll | Edge zone 15% (double speed within 5%), 3px per tick | Loads more range within one viewport width of either end | n/a | `hooks/use-auto-scroller.tsx`; `chart/main-content.tsx:110-123` |
| Dependencies | None in CE (stub returns false). No SVG paths. | n/a | Tessera ships dependency lines (git `7a71a22`): a deliberate addition | `apps/web/store/timeline/base-timeline.store.ts:345` |

## 12. Peek and full-page detail

| Element | Plane px | Alignment/state rule | Nearest Astryx token / Tessera rule | Plane source |
|---|---|---|---|---|
| Side peek | 50% of the whole shell, sidebar included (100% below 768). Full height. 1px left border, radius 4. Shadow: 0 4 8 /.12, 0 6 12 /.12, 0 1 16 /.12. 300ms. | Esc closes unless an input or menu is open. Outside click closes it except in portals, the row itself and the sidebar. | `tessera-peek-panel`: a 12px card 4px inside the panel, stored width 360-720, max 100% | `W/issues/peek-overview/view.tsx:123-144`; `hooks/use-peek-overview-outside-click.tsx` |
| Modal / full-screen peek | Modal: 83.33% square, centred. Full-screen: 16px inset; sidebar 400 wide with a left border. | n/a | "Open as" modes | `view.tsx:126-128,216-262` |
| Peek header | 16px padding on all sides, ≈60 high (inferred). Left: 16px icons, 16px gap. Right: subscribe (md, label hidden below 640), copy link and more (28 icon buttons), 8px gap. Save status 13 tertiary. | Bottom border only in full-screen mode | `DetailHeader` (pinned bar) | `W/issues/peek-overview/header.tsx:166-203` |
| Peek body | Padding 32 inline, 20 block. ≈24 between blocks (12px gap plus a 12px margin, inferred). Scrollbar 14. | Order: details, widgets, properties, activity | Detail body | `view.tsx:175-177` |
| Page detail main | Padding 36 inline, 20 block, 24 between blocks, no max width | Properties move under the widgets below 768 | Detail page | `W/issues/issue-detail/root.tsx:241-263` |
| Page detail sidebar | 25% wide, min 300 / 320 (lg) / 384 (xl), 24 inline padding, 1px left border. Below 768: fixed overlay (100% below 640, else 50%). | Forced collapsed below 768 | Side panel | `issue-detail/root.tsx:253`; `sidebar.tsx:84-87` |
| Title | Editable: 16/450 on a 20 line (tight). Read-only: 20/500. Max 255 characters; counter 11px. | The description text aligns with the title's left edge (negative margin cancels the editor padding) | Detail title | `W/issues/title-input.tsx:143-178` |
| Identifier row | 12/500 tertiary, click to copy. 10px below it; 16px gap to the save status. | n/a | Key | `main-content.tsx:80` |
| Parent chip | Padding 10 × 4, gap 12, radius 6, strong border, layer-1, 11px, dot 8. 20px below it. | Name truncated to 50 characters | n/a | `issue-detail/parent/root.tsx:79` |
| Property row | Label cell 120 wide, 30 high, icon 16, gap 6, 13 tertiary. Value cell: gap 4, wraps. 8px between cells. Rows 12 apart (peek) or 10 (page). | Label midline y = 15; value control 28 (midline 14), a 1px offset (inferred). Cycle and parent controls are 30 and match the label. | Detail property grid | `W/common/layout/sidebar/property-list-item.tsx:22-28`; `peek-overview/properties.tsx:81-82` |
| Widget buttons | Secondary md (28), icon 14, gap 8, wraps | Add sub-item, relation, link, attachment | n/a | `issue-detail-widgets/action-buttons.tsx:34` |
| Sub-item row | Min 44, 4 block padding, 8 end, 6 start. Chevron slot 20 (icon 14). Key 11. 12 to the name, name 13. Pills 8 apart. | Hover surface-2. Each nesting level indents 22. | n/a | `sub-issues/issues-list/list-item.tsx:125-186` |
| Relation / link / attachment rows | Relation: 44. Link: 40, radius 4, 0.5px border, 12 inline, 8 between rows. Attachment: 44, 12 inline. | Hover fills | n/a | `relations/issue-list-item.tsx:134`; `links/link-item.tsx:59`; `attachment-list-item.tsx:66` |
| Reactions | Fully round pill, 1px border, 6 inline padding, count 11, emoji 14, 8 between pills | Reacted: accent border and accent 10% fill. 200ms. | n/a | `B/emoji-reaction/emoji-reaction.tsx:80-91` |
| Activity item | Gap 12, 8 block padding (ends one-sided). Icon box 28, radius 8, 1px border, raised-100, glyph 14. Text 11 on a 13.2 line, one line. | 1px rail at x = 13, through the icon centre, continuous across rows | Activity list | `W/issues/issue-detail/issue-activity/.../activity-block.tsx:38-58` |
| Comment card | Radius 8, 1px border, padding 12, raised-100, 8 below. Header 12 below, 16px avatar, name 11/500. Body 12.8 on a 19.2 line (small font). | Same rail as activity | n/a | `W/comments/comment-block.tsx:30-45`; `card/display.tsx:120-143` |
| Composer | Radius 4, 1px border, 8 padding. Sticky at the bottom below 640. | n/a | n/a | `W/comments/comment-create.tsx:95` |

## 13. Planning: cycles, modules, views, projects

| Element | Plane px | Alignment/state rule | Nearest Astryx token / Tessera rule | Plane source |
|---|---|---|---|---|
| List row | Min 52 (including a 1px border), inline 21.6, 13px. Stacked below lg (below xl with a peek): 12 gap, 16 block padding. Above: 20 gap, 0 padding. Title cluster gap 12; leading element to title 16. | Hover 4%. No pressed or selected style. Extra actions shown on hover (always on mobile). | `List` rows on the 16px inset | `W/core/list/list-item.tsx:72-110` |
| Progress ring | 30 (a 20 ring scaled 150%). Centre text 9. Arc starts at 12 o'clock and animates over 300ms. | 100%: success colour and a tick | `ProgressBar` / ring | `W/cycles/list/cycles-list-item.tsx:43-57` |
| Group header (cycles) | 10 block padding (≈44 plus border, inferred). Icon 20, 20 to the title. Title 16/500, count 13/500. Chevron 16, rotates 180°. | Sticky, layer-1 | n/a | `cycle-list-group-header.tsx:28-44` |
| Active cycle cards | Grid: 1 / 2 (lg) / 3 (xl) columns, gap 12. Cards min 272 high, radius 8, padding 14 × 16, gap 20. | n/a | Summary card `--radius-container` | `W/cycles/active-cycle/root.tsx:70-87`; `progress.tsx:50` |
| Peek / detail side panel | Cycle 344 (16 padding). Module 384 (24 padding). 14 gap. Left border. 300ms. | Fixed full width below 768 | `tessera-planning-side-panel` 360, max 100% | `cycle-peek-overview.tsx:54`; `module-peek-overview.tsx:54` |
| Side panel properties | Label 40% (icon 16, 14 tertiary). Value 60% (28 controls). Rows 20 apart. | Status chip: 24 high, min 80, radius 4, 11/500, colour at ≈12.5% alpha | n/a | `W/cycles/analytics-sidebar/sidebar-details.tsx:69-143` |
| Burndown chart | 370 high. Margins 5 / 30 / 30 / 20. Horizontal grid only, no axis lines. Ticks 13 tertiary. Current line 2px with an area fill. Ideal line 1px, dashed 6 3. | Legend at the bottom: 8px swatches; hovering one fades the others to 10%. Tooltip 192 wide. | Burndown chart | `W/core/sidebar/progress-chart.tsx:50-65`; `B/charts/area-chart/root.tsx` |
| Module board | Gap 24, inline 21.6, columns 1 / 2 (lg) / 3 (xl), one fewer with the peek open. Card: radius 8, 0.5px border, padding 24, gap 12, ≈141 high (inferred). | Hover raised-200 over 300ms | n/a | `W/modules/modules-list-view.tsx:93-98`; `module-card-item.tsx:178-280` |
| Views row actions | Access icon 16. "Live" chip: padding 12 × 6, radius 4, 11/500, 6px dot. | n/a | n/a | `W/views/view-list-item-action.tsx` |
| Project grid | Gap 32, columns 1 / 2 (md) / 3 (lg). Card: radius 8, 1px border, cover 118, body 104 with 16 padding, ≈224 total. | Hover: strong border, raised-200 | Project rows (no grid) | `W/project/card-list.tsx:104-113`; `card.tsx:215-380` |
| Expanding search | Ghost 28 icon closed; 256 open (120 on mobile), radius 6, padding 10 × 6, icon 14 | Width animates linearly | n/a | `W/cycles/cycles-view-header.tsx:79-130` |

## 14. Settings

| Element | Plane px | Alignment/state rule | Nearest Astryx token / Tessera rule | Plane source |
|---|---|---|---|---|
| Content column | Max 900, 21.6 inline padding until the container reaches 943.2, then 0. 36 block padding. Hugging pages: 21.6 (48 from lg). | n/a | Reading column 960 | `W/settings/content-wrapper.tsx:23-34` |
| Settings sidebar | 250 wide, right border. Rows: radius 8, padding 8 × 6, 14/500, icon 14 in a 16 cell, ≈33.6 high. Category label 12/500 with 8 padding. Categories 12 apart with dividers. | Active: 8% overlay. Hidden below 768, replaced by a mobile bar. | n/a | `W/settings/sidebar/item.tsx:28-33`; `item-categories.tsx:47` |
| Page heading | Title 24/500 (h3), description 13 tertiary, 4 gap. Stacked below 768. Content starts 24 or 28 below. | n/a | `Heading` | `W/settings/heading.tsx:21-33` |
| Boxed control row | Radius 8, 1px border, layer-2, padding 16 × 12. Title 14/500, description 12, 6 gap. ≈66 high. | Stacked below 768 | Settings rows | `boxed-control-item.tsx:23` |
| State group | Radius 4, border, surface-2. Trigger 12 × 8, 14/500, icon 18. Groups 20 apart. | "+" ghost 24 | `StatesSettings` | `W/project-states/group-item.tsx:63` |
| State item | Radius 4, border, padding 14 × 12, no gap (borders double). Name 13/500, description 11. | Hover shows actions (20) and a drag handle 6px outside. Dragging 50%. | n/a | `state-item.tsx:134-140`; `state-item-title.tsx:50-95` |
| Label row | ≈47 high (inferred). 1.5px transparent outer border (2px accent as a drop target). Inner radius 4, 0.5px border, padding 4 × 12. Dot 14, gap 12, 80 end clearance. Children indent 24. | Actions shown on hover | `LabelsSettings` | `W/labels/project-setting-label-item.tsx:85-115` |
| Automation block | Icon tile 40, radius 4. Options box indented 52, radius 4, padding 20 × 16, label and control 50/50, 28 select. | n/a | `AutomationsSettings` | `W/automation/auto-archive-automation.tsx:93-115` |

## 15. Pages and editor

| Element | Plane px | Alignment/state rule | Nearest Astryx token / Tessera rule | Plane source |
|---|---|---|---|---|
| Reading column | 720 (wide 1152), centred. Gutters 20 (≤760 container). Wide gutters 96 between 912 and 1344, 20 at ≤912. Width changes over 200ms. | Toolbar, icon row, title and body share the column. The toolbar's first control starts 10 left of the text (inferred). | `PageScreen` | `E/styles/variables.css:14-17,197-298` |
| Page toolbar | 52 high, collapses to 0 over 300ms when off or read-only. Shown only from 768. Loader buttons 26. | Pane button 24, icon 14 | Editor toolbar | `W/pages/editor/toolbar/root.tsx:44-73` |
| Title | 32 on a 38 line, bold. 12 + 12 block padding. Small font: 25.6 / 30.4. | The -2% letter-spacing is invalid CSS and ignored | Page title | `E/styles/title-editor.css:11-26` |
| Body type (large, default) | p 16/24. h1 28/36, h2 24/32, h3 22/28, h4 20/24, h5 18/24, h6 16/24, all 600. Code 13.6. Small: body 12.8/19.2. Mobile: 15.2/24. | Headings: 28 top (h1-h4) or 20 (h5-h6), 4 bottom, none on the first child. Paragraphs 4 / 8 between. Lists 8. Quote: 3px left border. | Editor CSS on Astryx text tokens | `E/styles/variables.css:44-193`; `editor.css:48-52,325-430` |
| Logo / icon row | Icon row 48 high. Logo tile 56 shifted 8 left, glyph 48. | Shown on header hover, or when the title is empty | n/a | `W/pages/editor/header/root.tsx:34-58`; `logo-picker.tsx:29-53` |
| Outline (floating) | 64 from the top, sticky at 72. Bars 2 high: 20 / 18 / 14 wide, 8 apart. Hover card 208 wide, radius 4, padding 16, 300ms slide. | Hidden at ≤930 container. Entries indent 4 / 8 / 16 (h1 13px; h2 and h3 11px). | `PageOutline` | `W/pages/editor/summary/content-browser.tsx:57-77`; `heading-components.tsx:16-37` |
| Navigation pane | 294 wide, slides in from the right over 300ms. 14px insets. Contained tabs; 16 inline padding inside the panels. | Version rail: 24 column, 1px line, current node accent | Pages side pane | `W/pages/navigation-pane/root.tsx:89-107` |
| Lock control | Neutral 24 square. Locked: pill 24, padding 8, radius 4, accent 20%, label 11/500. Label slides in over 400ms; icon wiggles over 600ms; reverts 600ms after unlocking. | n/a | `LockControl` | `W/pages/header/lock-control.tsx:63-102`; `apps/web/styles/globals.css:46-131` |
| Slash menu | Max 320 high, min 192 wide, radius 6, 0.5px strong border, padding 8 × 10, raised-200. Item: padding 4 × 6, radius 4, 13px, icon box 20. | Hover and selected: layer-1-hover | Suggestion popover (12px around 8px rows) | `E/extensions/slash-commands/command-menu.tsx:140`; `command-menu-item.tsx:57-68` |
| Bubble menu | Radius 8, 1px border, 8 block padding, groups split by dividers. Buttons 28, icon 16. | n/a | Bubble menu | `E/components/menus/bubble-menu/root.tsx:194-225` |
| Block drag handle | 20, radius 2, hidden below 640, icon 14 | Selected block: accent 20% overlay, radius 4, 5px horizontal offset | n/a | `E/plugins/drag-handle.ts:51`; `drag-drop.css:46-67` |
| Pages list row | List row (52), prepend icon 16. A 20px rotated divider pulls its neighbours in 12. | Right-click menu | `PagesScreen` | `W/pages/list/block.tsx:46-50`; `block-item-action.tsx:45-96` |

## 16. Home, stickies, inbox, notifications, analytics

| Element | Plane px | Alignment/state rule | Nearest Astryx token / Tessera rule | Plane source |
|---|---|---|---|---|
| Home column | Max 800 centred, inline 21.6. Greeting 20/600, 24 margins. Widgets 32 apart. Widget title 14/600 tertiary, 16 below. | Widgets are not carded. Rows inside use an 8px inset (negative margins) so text meets the title edge. | `PanelPage width="reading"` 960 | `W/home/root.tsx:57-58`; `home-dashboard-widgets.tsx:83-103` |
| Quick link card | 230 × 56, radius 6, 0.5px border. Icon tile 32. Title 13/500, time 11. List gap 8, clipped at 150. | Menu shown on hover | `QuickLinksWidget` | `W/home/widgets/links/link-item-block.tsx:33-49` |
| Recents row | List row with 8 inline and 12 block padding (min 52). Icon tile 32. | Clipped at 415, "Show all" fades in | `RecentsList` | `W/home/widgets/recents/index.tsx:91-109` |
| Overflow clip | Fade 100 high collapsed, 30 expanded. Height animates over 300ms. | n/a | n/a | `W/core/content-overflow-HOC.tsx:110-163` |
| Stickies grid | Masonry with an 8px cell padding (16 gap). Columns by container: <640 → 2, <850 → 3, <1024 → 4, <1280 → 5, else 6. Card radius 4, min 256, max 540 (588 on the page), padding 16. | Toolbar 60 high, appears on focus over 300ms | `StickiesScreen` | `W/stickies/stickies-list.tsx:65,197-205`; `sticky/inputs.tsx:89-93` |
| Inbox layout | Sidebar 2/6 from 1024. Below that it is a full-width slide-in starting 50 down. Rows: 21.6 inline, 16 block padding, ≈105 high. Label chips 17.5 high, max 112. | Selected: 1px accent border all round. Hover accent 5%. | Intake screen | `W/inbox/root.tsx:62-114`; `sidebar/inbox-list-item.tsx:65-132` |
| Inbox detail header | Min 52, gap 8. Key 14/500. Prev and next are 28 icon buttons. | Mobile header below 1024 | n/a | `W/inbox/content/inbox-issue-header.tsx:303-462` |
| Notifications | Sidebar 25% from 768 (full width below). Row: 21.6 inline, 16 block padding, avatar 48, ≈80 high. Hover actions 20, icon 12. | Unread: accent 5% and a 6px dot at x = 8 (not vertically centred, a quirk). Tabs: 12 inline padding, 2px accent bar. | Inbox | `W/workspace-notifications/sidebar/notification-card/item.tsx:73-143` |
| Analytics | Tab bar padding 24 × 8. Content 24 × 16 (8px offset from the strip, a quirk). Sections 56 apart. Stats: label 13, value 20 bold, grid gap 32. Charts 350 / 370 high. Table cells 12 × 8. | Drill-in panel: 3/4 width, min 384, max 1024 | `OverviewPanel` | `W/analytics/analytics-wrapper.tsx:22-23`; `insight-card.tsx:23-32` |
| Chart defaults | Margins 5 / 30 / 5 / 20, horizontal grid, 2px strokes, dashes 4 4, bar 40. Ticks 13. Legend dots 8, radius 2. Tooltip 192 wide, 11px. | n/a | `ChartFrame` | `B/charts/*`; `components/tooltip.tsx:31-56` |

## Cross-cutting alignment rules

1. **One inline gutter.** The page header, secondary and filter headers, list rows, group headers, quick-add, spreadsheet header and cells, inbox and notification rows, and the page toolbar all start at the same x (Plane 21.6). The header title text and the row key or title share that x.
2. **Gutter furniture is absolute.** Selection checkboxes (at x = 4, 14 slot), drag handles (12 outside the row) and the editor block handle sit in the gutter, so they never shift text.
3. **Reserved slots keep columns aligned.** The 16px sub-item chevron slot is always reserved, key widths are computed from the identifier and the highest sequence, and hidden "…" buttons keep their space (opacity, not display).
4. **Midline centring.** Rows centre their content vertically. Text has a fixed 20px line for 13px type, and icons sit in fixed boxes (16 in rows and crumbs, 20 in menus and filter slots, 24 for header actions), so the glyph centre meets the text midline. Exception: property rows (30 label against 28 control, a 1px offset).
5. **Control centring in bars.** A 44 bar centres a 28 control with 8 above and below, and a 24 crumb with 10. A 52 bar centres a 28 control with 12.
6. **Rails run through icon centres.** The sidebar nested-items guide (x = 15, through a 16 logo), the activity and comment rail (x = 13, through a 28 box) and the version-history rail (24 column).
7. **Underlines touch the border.** Tab indicators sit on the header's bottom border: a full-height link with a 2px bar, or 3px pulled down by 12.
8. **Paired rows share a band.** Gantt sidebar and chart rows (44), hover and selection sync, and the header bands (48) line up. The board's top-row columns line up with each swimlane's (350 + 16).
9. **Insets nest by subtraction.** Collapsible panels pad 12 and rows inside cancel it with a −12 margin. Home rows and stickies use −8 so card edges meet the widget title.
10. **State ladder.** Rest, then hover (4%), then pressed (6%), then selected (8%) on transparent rows. Filled controls step their own fill. Selection uses an accent 5% tint (10% on hover). Peek or focus uses an accent border.
11. **Responsive pivots.** 768: header actions, sticky first column, sidebar auto-collapse, settings sidebar, calendar tiles. 1024 (sidebar open) or 768 (collapsed): list rows go to one line. 896 header container: layout switch and labels. 640: primary label and empty-state buttons.

## Where Tessera deliberately differs (do not flag)

All of these come from `docs/contracts/ui.md` (Shell, Theme, Work items, P3 "As built") unless marked otherwise.

| Topic | Plane | Tessera (intended) |
|---|---|---|
| Panel inset and corner | 8px frame on three sides (top bar flush), radius 8 | 8px on every side, `--radius-page` 16 |
| Inline gutter | 21.6 | 16 (`--spacing-4`) on every `PanelBar` and on row and cell end insets. List row start 12 (in-flow checkbox and key button bring their own padding). Table first column text at 16. |
| Header stack | 44 page header by default; 52 only in the tabbed mode | 52 `header` bar (token, h1, divider, tabs), then 44 `subheader`, then 44 `filters` |
| Project navigation | Accordion under each sidebar project (default) | Header tabs only; flat sidebar rows with a count |
| Title | Breadcrumbs 13/500 | `PanelTitle` h1 at 14 medium |
| Type | Inter, working size 13, captions 11 and 12, regular 450 | Source Sans 3, base 14 (20 line), supporting 12, normal 400, scale `{base 14, ratio 1.2}`; no 16px or 1rem assumptions |
| Radii | Chips 4 and 6, buttons 6, cards 8, dialogs 12 | inner 4 (chips, tokens), element 8 (buttons, inputs, nested cards), container 12 (cards, menus, dialogs, peek), page 16; concentric `calc()` |
| Row chips | 20 pills, 6 radius, subtle border, chevron-free | 24 chips, emphasized outline (3:1), `--radius-inner`, no chevron |
| Group header | ≈44 plus border, 16px title | 40 muted band, sticky trigger |
| Board | Fixed 350 columns on surface-2 | `min(350px, 100cqw)`, snaps below 480, concentric 16 column corners |
| Side peek | 50% of the shell, flush, radius 4 | 12 card 4 inside the panel border, width 360-720, max 100% |
| Planning side panel | 344 (cycle) or 384 (module) | 360, max 100% |
| Reading width | Home 800, settings 900, editor 720 | `PanelPage width="reading"` 960 (editor column per its own CSS) |
| Search | 364, grows to 554 with an inline dropdown | ≈364 read-only field that opens the Power K dialog |
| Colours | Neutral oklch with a blue accent; low-contrast subtle borders | Catppuccin Latte and Frappé; control outlines `--color-border-emphasized` at ≥3:1; text 4.5:1 |
| Focus | Mixed recipes; rows and links have none | Astryx 2px accent outline, 3px offset, on every focusable |
| Motion | 150 / 200 / 300ms | `--duration-fast` 140, `--duration-medium` 280, `--ease-standard` |
| Shadows | raised-100/200/300, overlay-100/200 | `--shadow-low`, `--shadow-med`, `--shadow-high` |
| Sidebar collapse | Width 0 with peek; auto below 768 | `mod+b` and the top-bar button; state not persisted |
| Gantt (from git, not ui.md) | No dependency lines, no today line | Dependency lines shipped (`7a71a22`) |
| Calendar (from git, not ui.md) | Week start from the user profile | Workspace week start on first render (`2d27cb1`) |

## Unresolved or conflicting between reports

- **Line height of bare 13px text.** It inherits 1.5 and gives 19.5 (inferred). A legacy comment implies 20, and body-xs is 20.02. Treat it as ≈20.
- **Identifier type.** It carries both 12/500 and the caption role 11/450; which wins depends on class merging. Unresolved.
- **Gutter token.** The timeline and workspace reports could not resolve the gutter or header tokens. The others resolved them from propel: 21.6 and 52.
- **Input 2xl height.** 40 per propel (planning report). The workspace report guessed 36. Use 40.
- **Inert shadows.** Plain small and large shadow utilities render nothing because propel resets them (inferred), so the sidebar's small shadow is inert.
- **Import line.** The tailwind-config import is cited as line 16 by most reports and as line 17 by the detail report.
- **Undefined breakpoint.** The 3xl breakpoint is undefined, so it does nothing (inferred).

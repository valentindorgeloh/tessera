# Plane.so vs Tessera: Complete Layout & Visual Architecture Comparison

**Date**: 2026-10-18  
**Analyst**: Mistral Vibe  
**Purpose**: Comprehensive analysis of Plane.so's layout system for improving Tessera

---

## 📊 Executive Summary

Both Tessera and Plane.so are project management applications built with modern React-based architectures. This document provides a detailed comparison of their layout systems, component structures, and visual design patterns to identify opportunities for improving Tessera.

**Key Finding**: Plane has a more sophisticated layout system with user-configurable preferences, animated state transitions, and resizable components. Tessera can adopt many of these patterns.

---

## 🏗️ Architecture Comparison

### 1. Overall Application Structure

#### Plane.so Structure
```
apps/web/
├── app/                      # Next.js app router
│   ├── (all)/[workspaceSlug]/  # Workspace-scoped routes
│   │   └── layout.tsx         # Workspace layout wrapper
│   └── layout.tsx            # Root app shell
├── components/
│   ├── base-layouts/         # Layout system (list, kanban, gantt)
│   │   ├── list/layout.tsx
│   │   ├── kanban/layout.tsx
│   │   ├── gantt/layout.tsx
│   │   └── layout-switcher.tsx
│   ├── navigation/           # App rail and navigation
│   │   ├── app-rail-root.tsx
│   │   ├── top-navigation-root.tsx
│   │   └── ...
│   ├── sidebar/              # Resizable sidebar
│   │   ├── resizable-sidebar.tsx
│   │   ├── sidebar-wrapper.tsx
│   │   └── ...
│   └── workspace/            # Workspace content
│       └── content-wrapper.tsx
└── layouts/                  # Authentication layouts
```

#### Tessera Structure
```
src/
├── app/
│   ├── (tessera)/            # Main application routes
│   │   └── layout.tsx        # App shell with sidebar
│   └── layout.tsx            # Root layout
├── components/
│   ├── shell/                # Application shell
│   │   ├── TesseraShell.tsx  # Main shell wrapper
│   │   ├── TopBar.tsx        # Top navigation bar
│   │   ├── Sidebar.tsx       # Resizable sidebar
│   │   └── ...
│   ├── work-items/          # Layout components
│   │   ├── ListLayout.tsx
│   │   ├── BoardLayout.tsx
│   │   ├── TableLayout.tsx
│   │   ├── CalendarLayout.tsx
│   │   └── GanttLayout.tsx
│   └── styles/               # CSS modules
│       ├── shell.css
│       ├── work-items.css
│       ├── table.css
│       ├── board.css
│       ├── calendar.css
│       └── gantt.css
└── lib/tessera/             # Business logic
```

**Key Difference**: Plane separates base layouts from domain-specific layouts, while Tessera combines them in work-items component.

---

## 🎨 Layout System Comparison

### 2. Layout Types

#### Plane.so
Plane defines **3 base layout types** (constants.ts):
1. **List** - `list` key, ListOutline icon
2. **Kanban** - `kanban` key, BoardOutline icon  
3. **Gantt** - `gantt` key, TimelineOutline icon

Each layout has:
- Standardized interface (`IBaseLayouts*Props`)
- Layout switcher component
- Grouped rendering with collapsible sections
- Drag-and-drop support

#### Tessera
Tessera has **5 layout types**:
1. **List** - ListLayout.tsx
2. **Board** - BoardLayout.tsx
3. **Table** - TableLayout.tsx
4. **Calendar** - CalendarLayout.tsx
5. **Gantt** - GanttLayout.tsx

**Difference**: Tessera has more layout variety (Table, Calendar) but lacks Plane's standardized interface approach.

---

### 3. Layout Switching

#### Plane's Approach
- **LayoutSwitcher.tsx**: Centralized component for switching between layouts
- **Features**:
  - Accepts `layouts` prop to restrict available options
  - Shows tooltip on hover (disabled on mobile)
  - Active layout highlighted with different background
  - Uses `cn()` utility for conditional classnames
  - Icons change color based on selection state

```tsx
// Plane's layout switcher
<div className="flex items-center gap-1 rounded-md bg-layer-3 p-1">
  {BASE_LAYOUTS.map((layout) => (
    <Tooltip key={layout.key} label={t(layout.label)} disabled={isMobile}>
      <button
        className={cn(
          "group grid h-5.5 w-7 place-items-center overflow-hidden rounded-sm transition-all hover:bg-layer-transparent-hover",
          {
            "bg-layer-transparent-active hover:bg-layer-transparent-active": 
              selectedLayout === layout.key,
          }
        )}
        onClick={() => handleOnChange(layout.key)}
      >
        <Icon width={14} height={14} strokeWidth={2} />
      </button>
    </Tooltip>
  ))}
</div>
```

#### Tessera's Current State
- Layout switching handled per-component
- No centralized layout switcher
- Each view type has its own display settings

**Recommendation**: Implement a centralized layout switcher like Plane's for consistency.

---

## 🎯 Side Navigation & Rail Comparison

### 4. App Rail (Left Sidebar)

#### Plane's App Rail
**Features**:
- Resizable with drag handle
- Collapsible with toggle
- User preference for display mode:
  - `icon_only` - Icons only
  - `icon_with_label` - Icons with text labels
- Context menu for configuration
- Width: 3rem (icon only) or 3.75rem (icon + label)
- Docked/undocked states

**Implementation** (`app-rail-root.tsx`):
```tsx
<div
  className="z-[26] h-full flex-shrink-0 bg-canvas transition-all duration-300 ease-in-out"
  style={{ width: railWidth }}
>
  <ContextMenu>
    <ContextMenuTrigger>
      <div className="flex h-full flex-col justify-between gap-4 px-2 py-3">
        <AppSidebarItemsRoot showLabel={showLabel} />
        <SettingsOutline className="size-5" />
      </div>
    </ContextMenuTrigger>
    <ContextMenuContent>
      <ContextMenuItem onClick={() => updateDisplayMode("icon_only")} 
                       label="Icon only" 
                       selected={preferences.displayMode === "icon_only"} />
      <ContextMenuItem onClick={() => updateDisplayMode("icon_with_label")} 
                       label="Icon with name" 
                       selected={preferences.displayMode === "icon_with_label"} />
      <ContextMenuSeparator />
      <ContextMenuItem onClick={toggleAppRail} 
                       label={isCollapsed ? "Dock App Rail" : "Undock App Rail"} />
    </ContextMenuContent>
  </ContextMenu>
</div>
```

#### Tessera's Sidebar
**Features**:
- Resizable with drag handle
- Collapsible with `mod+b` shortcut
- Fixed width range: 236-350px (default 250px)
- LocalStorage persistence for width
- No icon-only mode (always shows labels)

**Implementation** (`Sidebar.tsx`):
```tsx
// Width configuration
export const SIDEBAR_WIDTH = { 
  defaultWidth: 250, 
  minWidth: 236, 
  maxWidth: 350 
} as const;

// Resize hook
export function useSidebarResize():
  { key: string; 
    resizable: { 
      defaultWidth: number; 
      minWidth: number; 
      maxWidth: number; 
      onWidthChange: (width: number) => void 
    } }
```

**Comparison**:
| Feature | Plane | Tessera | Recommendation |
|---------|-------|---------|----------------|
| Resizable | ✅ | ✅ | - |
| Collapsible | ✅ | ✅ | - |
| Icon-only mode | ✅ | ❌ | Add to Tessera |
| Display preferences | ✅ | ❌ | Add to Tessera |
| Dock/undock | ✅ | ❌ | Consider adding |
| Width persistence | ✅ | ✅ | - |

---

### 5. Top Navigation

#### Plane's Top Navigation
**Features**:
- Workspace menu
- Power K search
- Inbox with notification badge
- Help menu
- User menu
- Adaptive padding based on display mode
- Height: 40px (10 = 2.5rem)

**Implementation** (`top-navigation-root.tsx`):
```tsx
<div className={cn(
  "z-[27] flex min-h-10 w-full items-center bg-canvas px-3.5 transition-all duration-300",
  { "px-2": !showLabel }
)}>
  <div className="flex-1 shrink-0">
    <WorkspaceMenuRoot variant="top-navigation" />
  </div>
  <div className="shrink-0">
    <TopNavPowerK />
  </div>
  <div className="flex flex-1 shrink-0 items-center justify-end gap-1">
    <InboxOutline />
    <HelpMenuRoot />
    <UserMenuRoot />
  </div>
</div>
```

#### Tessera's TopBar
**Features**:
- Workspace name
- Search field (Power K trigger)
- Quick links
- AI status
- Keyboard shortcuts button
- User settings

**Implementation** (`TopBar.tsx`):
```tsx
<PanelBar
  canWrap
  start={workspaceName}
  end={<HStack gap={1} vAlign="center">
    <SearchTrigger onOpen={openCommandBar} />
    {aiEnabled ? <AIStatusButton /> : null}
    <IconButton label="Shortcuts" icon={KeyboardIcon} onClick={openShortcuts} />
    <IconButton label="Help" icon={QuestionIcon} onClick={openHelp} />
    <UserMenu />
  </HStack>}
/>
```

**Comparison**:
| Feature | Plane | Tessera | Notes |
|---------|-------|---------|-------|
| Workspace menu | ✅ | ✅ (as text) | Plane has dropdown |
| Search/Power K | ✅ | ✅ | Both similar |
| Inbox/notifications | ✅ | ❌ | Missing in Tessera |
| Help menu | ✅ | ✅ | Both have |
| User menu | ✅ | ✅ | Both have |
| Adaptive padding | ✅ | ❌ | Tessera uses fixed padding |

---

## 📐 Content Layout Comparison

### 6. Workspace Content Wrapper

#### Plane's Approach
**Features**:
- Responsive to app rail visibility
- Smooth transitions (300ms ease-in-out)
- Conditional padding based on rail state
- Full height/width flex container

**Implementation** (`content-wrapper.tsx`):
```tsx
export const WorkspaceContentWrapper = observer(function WorkspaceContentWrapper({ children }) {
  const { shouldRenderAppRail } = useAppRailVisibility();

  return (
    <div className="relative flex size-full flex-col overflow-hidden bg-canvas transition-all duration-300 ease-in-out">
      <TopNavigationRoot />
      <div className="relative flex size-full overflow-hidden">
        {shouldRenderAppRail && <AppRailRoot />}
        <div className={cn(
          "relative size-full flex-grow overflow-hidden pr-2 pb-2 pl-2 transition-all duration-300 ease-in-out",
          { "pl-0!": shouldRenderAppRail }
        )}>
          {children}
        </div>
      </div>
    </div>
  );
});
```

#### Tessera's Approach
**Features**:
- Uses Astryx AppShell component
- Fixed content padding (2 = 8px)
- Card-based content panel
- Layout component for content area

**Implementation** (`TesseraShell.tsx`):
```tsx
<AppShell 
  height="fill" 
  variant="wash" 
  contentPadding={2} 
  topNav={<TopBar />} 
  sideNav={sideNav}
>
  <Card padding={0} height="100%" className="tessera-panel">
    <Layout height="fill" content={<LayoutContent isScrollable>{children}</LayoutContent>} 
            end={isOpen ? <AssistantPanel /> : undefined} />
  </Card>
</AppShell>
```

**Comparison**:
| Feature | Plane | Tessera | Notes |
|---------|-------|---------|-------|
| Flexbox layout | ✅ | ✅ | Both use flex |
| Transition animations | ✅ (300ms) | ❌ | Tessera lacks smooth transitions |
| Conditional padding | ✅ | ✅ | Both adaptive |
| AppShell wrapper | ❌ | ✅ | Tessera uses Astryx component |
| Card-based content | ❌ | ✅ | Tessera has rounded panel |

---

### 7. Layout Component Patterns

#### Plane's Base List Layout
**Features**:
- Observer pattern (mobx)
- Virtual scrolling support
- Collapsible groups
- Drag-and-drop support
- Load more on scroll
- External vs internal group state

**Implementation** (`base-layouts/list/layout.tsx`):
```tsx
export const BaseListLayout = observer(function BaseListLayout<T extends IBaseLayoutsListItem>(props) {
  const { items, groupedItemIds, groups, renderItem, renderGroupHeader, ... } = props;
  const { containerRef, collapsedGroups, onToggleGroup } = useLayoutState(...);

  return (
    <div ref={containerRef} className="relative size-full overflow-auto bg-surface-1">
      <div className="relative flex size-full flex-col">
        {groups.map((group) => (
          <BaseListGroup
            key={group.id}
            group={group}
            itemIds={groupedItemIds[group.id] || []}
            items={items}
            renderItem={renderItem}
            renderGroupHeader={renderGroupHeader}
            isCollapsed={collapsedGroups.includes(group.id)}
            onToggleGroup={onToggleGroup}
            enableDragDrop={enableDragDrop}
            onDrop={onDrop}
            canDrag={canDrag}
            loadMoreItems={loadMoreItems}
          />
        ))}
      </div>
    </div>
  );
});
```

#### Tessera's ListLayout
**Features**:
- Server actions for mutations
- Optimistic updates
- Drag-and-drop
- Keyboard shortcuts
- Quick add support

**Implementation** (`ListLayout.tsx`):
```tsx
export function ListLayout({ result, display, onUpdate, onOpen, onQuickAdd, ... }: LayoutProps) {
  const drag = usePointerDrag({...});
  const list = usePagedList({...});

  return (
    <VStack gap={2}>
      <PanelBar {...}>
        <GroupHeaders {...} />
      </PanelBar>
      <VStack gap={1}>
        {list.rows.map((row) => (
          <WorkItemRow
            key={row.item.id}
            row={row}
            display={display}
            onOpen={onOpen}
            onUpdate={onUpdate}
            itemHandlers={drag.itemHandlers(row.item.id)}
            {...}
          />
        ))}
      </VStack>
      {list.hasMore ? <LoadMore onLoadMore={list.loadMore} /> : null}
    </VStack>
  );
}
```

**Comparison**:
| Feature | Plane | Tessera | Notes |
|---------|-------|---------|-------|
| Observer pattern | ✅ (mobx) | ❌ | Tessera uses React hooks |
| Virtual scrolling | ✅ | ❌ | Plane more performant for large lists |
| Collapsible groups | ✅ | ✅ | Both support |
| Drag-and-drop | ✅ | ✅ | Both support |
| Load more | ✅ | ✅ | Both support |
| Server actions | ❌ | ✅ | Tessera more modern |

---

## 🎨 Visual Design & Styling Comparison

### 8. CSS & Styling Approach

#### Plane's Approach
- **Tailwind CSS v4** with custom theme
- **CSS Modules** for component styles
- **Propel Design System** (custom component library)
- **Global CSS** for animations and utilities
- **Theme variables** for dark/light mode

**File**: `apps/web/styles/globals.css`
```css
@import "@plane/tailwind-config/index.css";
@import "@plane/editor/styles";
@import "./power-k.css";
@import "./emoji.css";

:root {
  --editor-colors-gray-background: #d6d6d8;
  /* ... */
}

/* Lock icon animations */
@keyframes lockIconAnimation {
  0% { transform: rotate(-5deg) scale(1); }
  25% { transform: rotate(0deg) scale(1.15); }
  50% { transform: rotate(5deg) scale(1.08); }
  100% { transform: rotate(0deg) scale(1); }
}
```

#### Tessera's Approach
- **Astryx Design System** (external component library)
- **CSS Modules** for component styles
- **Catppuccin Theme** (custom theme)
- **No custom animations** for state transitions

**File**: `src/themes/catppuccin/catppuccin.css`
```css
:root {
  --color-accent: light-dark(#8839ef, #ca9ee6);
  --color-background-surface: light-dark(#eff1f5, #303446);
  --color-background-muted: light-dark(#dce0e8, #292c3c);
  --color-border: light-dark(#ccd0da, #414559);
  /* ... */
}
```

**Comparison**:
| Feature | Plane | Tessera | Notes |
|---------|-------|---------|-------|
| Design system | Propel (custom) | Astryx (external) | Different approaches |
| CSS framework | Tailwind v4 | Astryx tokens | Plane more flexible |
| Animations | ✅ Custom | ❌ None | Tessera lacks animations |
| Theme system | ✅ Custom | ✅ Catppuccin | Both good |
| Dark mode | ✅ | ✅ | Both support |

---

### 9. Component Styling Patterns

#### Plane's Button Styling
```tsx
<button
  type="button"
  className={cn(
    "group grid h-5.5 w-7 place-items-center overflow-hidden rounded-sm ",
    "transition-all hover:bg-layer-transparent-hover",
    {
      "bg-layer-transparent-active hover:bg-layer-transparent-active": selected,
    }
  )}
  onClick={onClick}
>
  <Icon width={14} height={14} strokeWidth={2} />
</button>
```

#### Tessera's Button Styling
```tsx
<IconButton
  label={label}
  size="sm"
  variant="ghost"
  icon={icon}
  onClick={onClick}
/>
```

**Comparison**:
- **Plane**: More explicit styling, uses `cn()` for conditional classes
- **Tessera**: Uses Astryx component props, more declarative

---

## 🔧 Specific Component Comparisons

### 10. Calendar Components

#### Plane's Calendar
**Files**:
- `apps/web/components/issues/issue-layouts/calendar/calendar.tsx` - Main calendar
- `apps/web/components/issues/issue-layouts/calendar/base-calendar-root.tsx` - Root wrapper
- `apps/web/components/issues/issue-layouts/calendar/week-days.tsx` - Week day rendering
- `apps/web/components/issues/issue-layouts/calendar/day-tile.tsx` - Day tile
- `packages/utils/src/calendar.ts` - Calendar utilities
- `packages/constants/src/calendar.ts` - Calendar constants
- `packages/types/src/calendar.ts` - Calendar types

**Features**:
- User-configurable week start (Sunday/Monday)
- Drag-and-drop for issues
- Quick add support
- Week/month views
- Responsive design
- Date range selection

**Week Start Handling**:
```tsx
// In week-days.tsx
const { data } = useUserProfile();
const startOfWeek = data?.start_of_the_week;
const sortedWeekDays = getOrderedDays(Object.values(week), (item) => item.date.getDay(), startOfWeek);
```

#### Tessera's Calendar
**Files**:
- `src/components/work-items/CalendarLayout.tsx` - Main calendar
- `src/components/work-items/calendar-math.ts` - Calendar utilities
- `src/components/styles/calendar.css` - Calendar styles

**Features**:
- Month and week views
- Drag-and-drop for work items
- Quick add support
- Day cell rendering with max items
- Unscheduled items popover

**Week Start Handling**:
```tsx
// In calendar-math.ts
export const WEEK_STARTS_ON: WeekStart = 1; // Hardcoded to Monday
```

**Comparison**:
| Feature | Plane | Tessera | Recommendation |
|---------|-------|---------|----------------|
| User configurable week start | ✅ | ❌ | **Add to Tessera** |
| Drag-and-drop | ✅ | ✅ | - |
| Quick add | ✅ | ✅ | - |
| Week/month views | ✅ | ✅ | - |
| Date popover week start | ✅ (respects user pref) | ❌ (hardcoded) | **Fix in Tessera** |
| Animated transitions | ✅ | ❌ | Add animations |

---

### 11. Lock/Unlock Control

#### Plane's Lock Control
**File**: `apps/web/components/pages/header/lock-control.tsx`

**Features**:
- Three-state system: neutral, locked, unlocked
- Animated transitions between states
- Brief "Unlocked" message that fades out
- CSS animations for icon and text
- Tooltip support

**Implementation**:
```tsx
type LockDisplayState = "neutral" | "locked" | "unlocked";

const [displayState, setDisplayState] = useState<LockDisplayState>(page.is_locked ? "locked" : "neutral");
const prevLockedRef = useRef(is_locked);

useEffect(() => {
  if (is_locked) {
    setDisplayState("locked");
  } else if (prevLockedRef.current === true) {
    // Transition from locked to unlocked
    setDisplayState("unlocked");
    timerRef.current = setTimeout(() => {
      setDisplayState("neutral");
    }, 600);
  } else {
    setDisplayState("neutral");
  }
  prevLockedRef.current = is_locked;
}, [is_locked]);

// Render different UI for each state
return (
  <>
    {displayState === "neutral" && <LockedOutline className="size-3.5" />}
    {displayState === "locked" && (
      <>
        <LockedOutline className="animate-lock-icon size-3.5" />
        <span className="animate-text-slide-in">Locked</span>
      </>
    )}
    {displayState === "unlocked" && (
      <>
        <UnlockedOutline className="animate-unlock-icon size-3.5" />
        <span className="animate-text-slide-in animate-text-fade-out">Unlocked</span>
      </>
    )}
  </>
);
```

#### Tessera's Lock Control
**Current State**:
- Simple icon toggle without state management
- Icon uses `page.is_locked` prop directly
- No animation or transition feedback

**Implementation** (`PageScreen.tsx`):
```tsx
<IconButton
  variant="ghost"
  size="sm"
  label={page.is_locked ? "Unlock page" : "Lock page"}
  tooltip={page.is_locked ? "Unlock page" : "Lock page (shift+l)"}
  icon={<Icon icon={page.is_locked ? UnlockIcon : LockIcon} />}
  onClick={toggleLock}
/>
```

**Comparison**:
| Feature | Plane | Tessera | Recommendation |
|---------|-------|---------|----------------|
| Three-state system | ✅ | ❌ | **Adopt Plane's pattern** |
| Animated transitions | ✅ | ❌ | **Add CSS animations** |
| Visual feedback | ✅ (600ms fade) | ❌ | **Implement state transitions** |
| Icon consistency | ✅ | ✅ | - |
| Tooltip | ✅ | ✅ | - |

---

### 12. Gantt Chart

#### Plane's Gantt
**Files**:
- `apps/web/components/gantt-chart/chart/root.tsx` - Main Gantt chart
- `apps/web/components/gantt-chart/chart/views/` - Different time views
- `apps/web/components/base-layouts/gantt/layout.tsx` - Layout wrapper
- `apps/web/components/base-layouts/gantt/sidebar.tsx` - Sidebar

**Features**:
- Multiple timeline types (issue, project, etc.)
- Block-based rendering
- Dependency support
- Resize and move support
- Zoom levels (day, week, month, quarter)
- Today indicator
- Context menus

#### Tessera's Gantt
**Files**:
- `src/components/work-items/GanttLayout.tsx` - Main Gantt layout
- `src/components/styles/gantt.css` - Gantt styles

**Features**:
- Day-based timeline
- Bar rendering for work items
- Drag to resize
- Today indicator
- Weekend highlighting
- Fixed column width (32px per day)

**Comparison**:
| Feature | Plane | Tessera | Recommendation |
|---------|-------|---------|----------------|
| Multiple zoom levels | ✅ | ❌ | **Add zoom support** |
| Dependency support | ✅ | ❌ | **Consider adding** |
| Resize support | ✅ | ✅ | - |
| Today indicator | ✅ | ✅ | - |
| Weekend highlighting | ✅ | ✅ | - |
| Block-based | ✅ | ❌ (bar-based) | Different approaches |

---

## 🎯 Key Improvements for Tessera

Based on the Plane.so comparison, here are the **top recommendations** for Tessera:

### Priority 1: Critical UX Issues

1. **Fix Lock/Unlock Icon State**
   - Implement Plane's three-state pattern (neutral/locked/unlocked)
   - Add animated transitions between states
   - Show brief "Unlocked" feedback that fades out
   - **Files to modify**: `PageScreen.tsx`, `ViewMenu.tsx`, `PageRowMenu.tsx`
   - **New files needed**: CSS animations in global styles

2. **Implement User-Configurable Week Start**
   - Add `start_of_week` user preference
   - Update `calendar-math.ts` to accept dynamic week start
   - Ensure DateInput respects the setting
   - **Files to modify**: `calendar-math.ts`, user preferences storage, DateInput wrapper
   - **New feature**: Settings UI for week start preference

### Priority 2: Layout System Enhancements

3. **Centralized Layout Switcher**
   - Create a `LayoutSwitcher` component like Plane's
   - Standardize layout switching across all views
   - Add tooltips and visual feedback
   - **Files to create**: `components/work-items/LayoutSwitcher.tsx`

4. **Resizable Sidebar Enhancements**
   - Add icon-only mode (like Plane's display preferences)
   - Add dock/undock capability
   - Smooth transition animations (300ms ease-in-out)
   - **Files to modify**: `Sidebar.tsx`

5. **Improve TopBar**
   - Add notification/inbox indicator
   - Adaptive padding based on sidebar state
   - Better visual hierarchy
   - **Files to modify**: `TopBar.tsx`

### Priority 3: Visual Polish

6. **Add CSS Animations**
   - Lock/unlock icon animations
   - Text slide-in/out animations
   - Fade transitions for state changes
   - **Files to create**: Add to global CSS or shell.css

7. **Smooth Transitions**
   - Add 300ms ease-in-out transitions for layout changes
   - Smooth sidebar collapse/expand
   - Fade in/out for content changes
   - **Files to modify**: All layout components

8. **Fix Asymmetric Padding**
   - Standardize padding in table layout
   - Review work-items list padding
   - Ensure visual balance across components
   - **Files to modify**: `table.css`, `work-items.css`, `detail.css`

### Priority 4: Advanced Features

9. **Virtual Scrolling for Large Lists**
   - Implement virtualization for better performance
   - Adopt Plane's approach for large datasets
   - **Files to create**: Virtual scrolling utilities

10. **Calendar Zoom Levels**
    - Add week/month/quarter zoom for Gantt
    - Implement timeline scaling
    - **Files to modify**: `GanttLayout.tsx`, calendar utilities

---

## 📊 Comparison Matrix

| Category | Plane | Tessera | Gap | Recommendation |
|----------|-------|---------|-----|----------------|
| **Layout Types** | 3 (list, kanban, gantt) | 5 (list, board, table, calendar, gantt) | ✅ Tessera more | Standardize interface |
| **Layout Switching** | ✅ Centralized | ❌ Per-component | ❌ | Add centralized switcher |
| **Sidebar** | ✅ Resizable, icon-only mode, dockable | ✅ Resizable, collapsible | ❌ | Add icon-only & dock |
| **Top Navigation** | ✅ Full-featured | ✅ Basic | ❌ | Add inbox, improve spacing |
| **Calendar Week Start** | ✅ User configurable | ❌ Hardcoded Monday | ❌ | **High priority fix** |
| **Lock/Unlock UX** | ✅ 3-state with animations | ❌ 2-state no feedback | ❌ | **High priority fix** |
| **Animations** | ✅ Custom CSS animations | ❌ None | ❌ | Add state transition animations |
| **Virtual Scrolling** | ✅ Implemented | ❌ Not implemented | ❌ | Add for performance |
| **Design System** | ✅ Propel (custom) | ✅ Astryx (external) | - | Both good, different approaches |
| **CSS Framework** | ✅ Tailwind v4 | ✅ Astryx tokens | - | Plane more flexible |

---

## 🎯 Implementation Roadmap

### Phase 1: Critical UX Fixes (Week 1-2)
1. Fix lock/unlock icon state management
2. Implement user-configurable week start
3. Add smooth transitions for layout changes

### Phase 2: Layout Enhancements (Week 3-4)
1. Create centralized layout switcher
2. Add icon-only mode to sidebar
3. Improve TopBar with notifications

### Phase 3: Visual Polish (Week 5-6)
1. Add CSS animations for state transitions
2. Fix asymmetric padding issues
3. Run contrast ratio audit

### Phase 4: Advanced Features (Week 7+)
1. Implement virtual scrolling
2. Add calendar zoom levels
3. Add dependency support to Gantt

---

## 📚 Key Files for Reference

### Plane.so Layout System
- `apps/web/components/base-layouts/` - Base layout components
- `apps/web/components/navigation/` - Navigation components
- `apps/web/components/sidebar/` - Sidebar components
- `apps/web/components/workspace/content-wrapper.tsx` - Content layout
- `packages/utils/src/calendar.ts` - Calendar utilities
- `packages/types/src/calendar.ts` - Calendar types

### Tessera Layout System
- `src/components/shell/TesseraShell.tsx` - Main shell
- `src/components/shell/Sidebar.tsx` - Sidebar
- `src/components/shell/TopBar.tsx` - Top navigation
- `src/components/work-items/` - Layout components
- `src/components/styles/` - CSS modules

---

## 🔗 Useful Patterns from Plane.so

### 1. Three-State Pattern for Lock/Unlock
```tsx
type DisplayState = "neutral" | "locked" | "unlocked";
const [displayState, setDisplayState] = useState<DisplayState>(isLocked ? "locked" : "neutral");
const prevLockedRef = useRef(isLocked);

useEffect(() => {
  if (isLocked) {
    setDisplayState("locked");
  } else if (prevLockedRef.current === true) {
    setDisplayState("unlocked");
    setTimeout(() => setDisplayState("neutral"), 600);
  } else {
    setDisplayState("neutral");
  }
  prevLockedRef.current = isLocked;
}, [isLocked]);
```

### 2. User Preference Pattern
```tsx
// Store preference
const { preferences, updateDisplayMode } = useAppRailPreferences();

// Apply preference
const showLabel = preferences.displayMode === "icon_with_label";
const railWidth = showLabel ? "3.75rem" : "3rem";

// Update preference
const handleChange = (mode: "icon_only" | "icon_with_label") => {
  updateDisplayMode(mode);
};
```

### 3. Resizable Component Pattern
```tsx
const [isResizing, setIsResizing] = useState(false);
const [width, setWidth] = useState(defaultWidth);

const handleResize = (e: MouseEvent) => {
  if (!isResizing) return;
  const deltaX = e.clientX - initialMouseX;
  const newWidth = Math.min(Math.max(initialWidth + deltaX, minWidth), maxWidth);
  setWidth(newWidth);
};

const startResizing = (e: React.MouseEvent) => {
  setIsResizing(true);
  initialWidthRef.current = width;
  initialMouseXRef.current = e.clientX;
};

const stopResizing = () => setIsResizing(false);
```

---

## 📈 Conclusion

Plane.so demonstrates several **best practices** that Tessera can adopt:

1. **User-configurable preferences** - Week start, display modes, sidebar behavior
2. **State transition animations** - Visual feedback for user actions
3. **Centralized layout management** - Consistent layout switching
4. **Smooth transitions** - 300ms ease-in-out for all layout changes
5. **Responsive padding** - Adaptive based on component state

**Recommendation**: Start with the **lock/unlock fix** and **week start configuration** as these are high-impact, low-complexity changes that will significantly improve the user experience.

The full comparison shows that Tessera has a solid foundation but can benefit from adopting Plane's UX patterns and visual polish.

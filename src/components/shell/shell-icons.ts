import type { IconType } from "@astryxdesign/core/Icon";
import {
  ArchiveIcon,
  CycleIcon,
  DraftIcon,
  FolderIcon,
  GearIcon,
  HouseIcon,
  IntakeIcon,
  KanbanIcon,
  ListBulletsIcon,
  ModuleIcon,
  MonitorIcon,
  MoonIcon,
  PageIcon,
  SunIcon,
  ViewIcon,
} from "@/themes/catppuccin/icons";
import type { ColorScheme } from "./color-scheme";
import type { RouteIconKey } from "./recents";

/** Glyphs for the route icon keys of ./recents.ts, shared by Home's recents list and Power K's "Recent" group. */
export const ROUTE_ICONS: Readonly<Record<RouteIconKey, IconType>> = {
  home: HouseIcon,
  projects: FolderIcon,
  "work-items": KanbanIcon,
  "work-item": ListBulletsIcon,
  page: PageIcon,
  cycles: CycleIcon,
  cycle: CycleIcon,
  modules: ModuleIcon,
  module: ModuleIcon,
  views: ViewIcon,
  view: ViewIcon,
  settings: GearIcon,
  archives: ArchiveIcon,
  intake: IntakeIcon,
  drafts: DraftIcon,
};

/** Glyphs for the colour schemes, shared by the account menu and Power K's theme commands. */
export const COLOR_SCHEME_ICONS: Readonly<Record<ColorScheme, IconType>> = {
  dark: MoonIcon,
  light: SunIcon,
  system: MonitorIcon,
};

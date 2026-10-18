import type { IconType } from "@astryxdesign/core/Icon";
import {
  AgentIcon,
  ArchiveIcon,
  BurndownIcon,
  CycleIcon,
  DescriptionIcon,
  DraftIcon,
  ExportIcon,
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
  UserIcon,
  ViewIcon,
  WebhookIcon,
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
  // UserCircleIcon, ChartBarIcon, RobotIcon and NoteIcon are not exported.
  // User, the burndown chart, the agent robot and the description glyph stand in.
  "your-work": UserIcon,
  agents: AgentIcon,
  analytics: BurndownIcon,
  stickies: DescriptionIcon,
  exports: ExportIcon,
  webhooks: WebhookIcon,
};

/** Glyphs for the colour schemes, shared by the account menu and Power K's theme commands. */
export const COLOR_SCHEME_ICONS: Readonly<Record<ColorScheme, IconType>> = {
  dark: MoonIcon,
  light: SunIcon,
  system: MonitorIcon,
};

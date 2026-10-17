import React, {type SVGProps} from "react";
import {
  ArrowDown,
  ArrowSquareOut,
  ArrowUp,
  ArrowsDownUp,
  CalendarBlank,
  CaretDoubleLeft,
  CaretDoubleRight,
  CaretDown,
  CaretLeft,
  CaretRight,
  Check,
  CheckCircle,
  Checks,
  Clock,
  Columns,
  Compass,
  Copy,
  DotsThree,
  EyeSlash,
  FileText,
  Folder,
  FolderPlus,
  Funnel,
  House,
  Info,
  Kanban,
  List,
  ListBullets,
  MagnifyingGlass,
  Microphone,
  Plus,
  SquaresFour,
  Stop,
  Warning,
  Wrench,
  X,
  XCircle,
  // Lane C (work items): priority glyphs, display menu, property and project logo icons.
  ArrowsClockwise,
  ArrowsOutLineHorizontal,
  Book,
  Briefcase,
  Bug,
  CellSignalFull,
  CellSignalHigh,
  CellSignalLow,
  CellSignalMedium,
  Cube,
  Diamond,
  Fire,
  Flag,
  Gear,
  Globe,
  Hash,
  Leaf,
  Lightning,
  Package,
  Prohibit,
  Rocket,
  Rows,
  Sliders,
  Star,
  Table,
  Tag,
  Target,
  Trash,
  User,
  Users,
  // Colour scheme menu (top bar account menu).
  Monitor,
  Moon,
  Sun,
  // Lane D (detail): header actions, mode switcher and subscription glyphs.
  ArrowsOutSimple,
  Bell,
  BellSlash,
  Link,
  PencilSimple,
  SidebarSimple,
  // Lane D4 (Power K): command bar sections, the help dialog and the Ask tab.
  Keyboard,
  Sparkle,
  // Lane D1 (editor): drag handle, bubble menu marks and the source toggle.
  Code,
  DotsSixVertical,
  FileCode,
  LinkSimple,
  TextB,
  TextItalic,
  TextStrikethrough,
  // Editor table controls (full width only).
  ColumnsPlusLeft,
  ColumnsPlusRight,
  RowsPlusBottom,
  RowsPlusTop,
  // P3 planning: cycles, charts, transfer and archives.
  Archive,
  ArrowCounterClockwise,
  ArrowsLeftRight,
  CalendarDots,
  ChartLineDown,
  ChartLineUp,
  Timer,
  // Shell frame: top bar help and the recents list.
  ClockCounterClockwise,
  Question,
  // Detail rework: property rail labels and activity timeline tiles.
  CircleHalf,
  TextAlignLeft,
  TreeStructure,
  Triangle,
  // P4 views and settings.
  ArrowUUpLeft,
  FloppyDisk,
  LockSimple,
  LockSimpleOpen,
  Robot,
  Stack,
  ToggleRight,
  Tray,
  type Icon as PhosphorIcon,
  type IconProps,
} from "@phosphor-icons/react";
import type {IconRegistry} from "@astryxdesign/core/Icon";

const duotone = {
  weight: "duotone" as const,
  size: "1em",
  "aria-hidden": true as const,
};

function glyph(IconComponent: PhosphorIcon) {
  return <IconComponent {...duotone} />;
}

/** Phosphor Duotone component Astryx can size and color. */
export function duotoneIcon(IconComponent: PhosphorIcon) {
  function DuotoneIcon(props: SVGProps<SVGSVGElement>) {
    return <IconComponent weight="duotone" {...(props as IconProps)} />;
  }
  DuotoneIcon.displayName = IconComponent.displayName;
  return DuotoneIcon;
}

export const FolderIcon = duotoneIcon(Folder);
export const PageIcon = duotoneIcon(FileText);
export const PlusIcon = duotoneIcon(Plus);
export const FolderPlusIcon = duotoneIcon(FolderPlus);
export const SearchIcon = duotoneIcon(MagnifyingGlass);

// Tessera shell (lane B): navigation, recents and boundary glyphs.
export const HouseIcon = duotoneIcon(House);
export const KanbanIcon = duotoneIcon(Kanban);
export const ListBulletsIcon = duotoneIcon(ListBullets);
export const SquaresFourIcon = duotoneIcon(SquaresFour);
export const CompassIcon = duotoneIcon(Compass);
export const WarningIcon = duotoneIcon(Warning);
export const XIcon = duotoneIcon(X);
export const CaretRightIcon = duotoneIcon(CaretRight);
export const CaretDownIcon = duotoneIcon(CaretDown);
export const DotsThreeIcon = duotoneIcon(DotsThree);

// Colour scheme switcher: Frappé (dark), Latte (light), match system.
export const MoonIcon = duotoneIcon(Moon);
export const SunIcon = duotoneIcon(Sun);
export const MonitorIcon = duotoneIcon(Monitor);

export const catppuccinIconRegistry: IconRegistry = {
  close: glyph(X),
  chevronDown: glyph(CaretDown),
  chevronLeft: glyph(CaretLeft),
  chevronRight: glyph(CaretRight),
  chevronsLeft: glyph(CaretDoubleLeft),
  chevronsRight: glyph(CaretDoubleRight),
  check: glyph(Check),
  success: glyph(CheckCircle),
  error: glyph(XCircle),
  warning: glyph(Warning),
  info: glyph(Info),
  calendar: glyph(CalendarBlank),
  clock: glyph(Clock),
  externalLink: glyph(ArrowSquareOut),
  menu: glyph(List),
  moreHorizontal: glyph(DotsThree),
  search: glyph(MagnifyingGlass),
  arrowUp: glyph(ArrowUp),
  arrowDown: glyph(ArrowDown),
  arrowsUpDown: glyph(ArrowsDownUp),
  funnel: glyph(Funnel),
  eyeSlash: glyph(EyeSlash),
  viewColumns: glyph(Columns),
  copy: glyph(Copy),
  checkDouble: glyph(Checks),
  wrench: glyph(Wrench),
  stop: glyph(Stop),
  microphone: glyph(Microphone),
};

// Tessera work items (lane C): priority glyphs, display menu and property icons.
export const PriorityUrgentIcon = duotoneIcon(CellSignalFull);
export const PriorityHighIcon = duotoneIcon(CellSignalHigh);
export const PriorityMediumIcon = duotoneIcon(CellSignalMedium);
export const PriorityLowIcon = duotoneIcon(CellSignalLow);
export const PriorityNoneIcon = duotoneIcon(Prohibit);
export const SlidersIcon = duotoneIcon(Sliders);
export const RowsIcon = duotoneIcon(Rows);
export const TableIcon = duotoneIcon(Table);
export const CalendarIcon = duotoneIcon(CalendarBlank);
export const GanttIcon = duotoneIcon(ArrowsOutLineHorizontal);
export const TagIcon = duotoneIcon(Tag);
export const UserIcon = duotoneIcon(User);
export const UsersIcon = duotoneIcon(Users);
export const CycleIcon = duotoneIcon(ArrowsClockwise);
export const ModuleIcon = duotoneIcon(Package);
export const TargetIcon = duotoneIcon(Target);
export const HashIcon = duotoneIcon(Hash);
export const TrashIcon = duotoneIcon(Trash);
export const CheckIcon = duotoneIcon(Check);

// Tessera detail (lane D): header actions, mode switcher and subscription glyphs.
export const ArrowSquareOutIcon = duotoneIcon(ArrowSquareOut);
export const ArrowsOutIcon = duotoneIcon(ArrowsOutSimple);
export const BellIcon = duotoneIcon(Bell);
export const BellSlashIcon = duotoneIcon(BellSlash);
export const CopyIcon = duotoneIcon(Copy);
export const LinkIcon = duotoneIcon(Link);
export const PencilIcon = duotoneIcon(PencilSimple);
export const SidebarIcon = duotoneIcon(SidebarSimple);

// Tessera Power K (lane D4): command bar sections, the help dialog and the Ask tab.
export const GearIcon = duotoneIcon(Gear);
export const KeyboardIcon = duotoneIcon(Keyboard);
export const LightningIcon = duotoneIcon(Lightning);
export const SparkleIcon = duotoneIcon(Sparkle);

// Tessera editor (lane D1): drag handle, bubble menu marks and the source toggle.
export const CodeIcon = duotoneIcon(Code);
export const DragHandleIcon = duotoneIcon(DotsSixVertical);
export const FileCodeIcon = duotoneIcon(FileCode);
export const LinkSimpleIcon = duotoneIcon(LinkSimple);
export const TextBoldIcon = duotoneIcon(TextB);
export const TextItalicIcon = duotoneIcon(TextItalic);
export const TextStrikethroughIcon = duotoneIcon(TextStrikethrough);
export const ColumnAddLeftIcon = duotoneIcon(ColumnsPlusLeft);
export const ColumnAddRightIcon = duotoneIcon(ColumnsPlusRight);
export const RowAddAboveIcon = duotoneIcon(RowsPlusTop);
export const RowAddBelowIcon = duotoneIcon(RowsPlusBottom);
export const ArchiveIcon = duotoneIcon(Archive);
export const BurndownIcon = duotoneIcon(ChartLineDown);
export const BurnupIcon = duotoneIcon(ChartLineUp);
export const CalendarDotsIcon = duotoneIcon(CalendarDots);
export const RestoreIcon = duotoneIcon(ArrowCounterClockwise);
export const TimerIcon = duotoneIcon(Timer);
export const TransferIcon = duotoneIcon(ArrowsLeftRight);

// Shell frame: top bar help and the recents list.
export const QuestionIcon = duotoneIcon(Question);
export const RecentIcon = duotoneIcon(ClockCounterClockwise);

// Detail rework: property rail labels and activity timeline tiles.
export const StateIcon = duotoneIcon(CircleHalf);
export const ParentIcon = duotoneIcon(TreeStructure);
export const EstimateIcon = duotoneIcon(Triangle);
export const ClockIcon = duotoneIcon(Clock);
export const DescriptionIcon = duotoneIcon(TextAlignLeft);
export const ReorderIcon = duotoneIcon(ArrowsDownUp);
// P4 views and settings.
export const ViewIcon = duotoneIcon(Stack);
export const LockIcon = duotoneIcon(LockSimple);
export const UnlockIcon = duotoneIcon(LockSimpleOpen);
export const SaveIcon = duotoneIcon(FloppyDisk);
export const ResetIcon = duotoneIcon(ArrowUUpLeft);
export const FeaturesIcon = duotoneIcon(ToggleRight);
export const IntakeIcon = duotoneIcon(Tray);
export const AgentIcon = duotoneIcon(Robot);
export const MoveUpIcon = duotoneIcon(ArrowUp);
export const MoveDownIcon = duotoneIcon(ArrowDown);

/**
 * Icons a project logo may use (`Logo.icon` holds the Phosphor name). The
 * create dialog offers exactly these; `resolveLogoIcon` falls back to the
 * folder glyph for unknown or missing names so old rows keep rendering.
 */
export const PROJECT_LOGO_ICONS = {
  Folder: FolderIcon,
  Rocket: duotoneIcon(Rocket),
  Cube: duotoneIcon(Cube),
  Kanban: KanbanIcon,
  Star: duotoneIcon(Star),
  Flag: duotoneIcon(Flag),
  Briefcase: duotoneIcon(Briefcase),
  Globe: duotoneIcon(Globe),
  Book: duotoneIcon(Book),
  Fire: duotoneIcon(Fire),
  Leaf: duotoneIcon(Leaf),
  Diamond: duotoneIcon(Diamond),
  Target: TargetIcon,
  Package: ModuleIcon,
  Lightning: duotoneIcon(Lightning),
  Bug: duotoneIcon(Bug),
  Gear: duotoneIcon(Gear),
} as const;

export type ProjectLogoIconName = keyof typeof PROJECT_LOGO_ICONS;

export const PROJECT_LOGO_ICON_NAMES = Object.keys(PROJECT_LOGO_ICONS) as ProjectLogoIconName[];

function isLogoIconName(name: string): name is ProjectLogoIconName {
  return Object.prototype.hasOwnProperty.call(PROJECT_LOGO_ICONS, name);
}

/** Component for a stored logo icon name; the folder glyph when the name is unknown. */
export function resolveLogoIcon(name: string | null | undefined): (typeof PROJECT_LOGO_ICONS)[ProjectLogoIconName] {
  return name && isLogoIconName(name) ? PROJECT_LOGO_ICONS[name] : FolderIcon;
}

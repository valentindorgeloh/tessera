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

// Tessera shell (lane B): navigation, tab bar and boundary glyphs.
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

export const paperIconRegistry: IconRegistry = {
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

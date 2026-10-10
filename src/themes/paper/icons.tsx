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
  Copy,
  DotsThree,
  EyeSlash,
  FileText,
  Folder,
  FolderPlus,
  Funnel,
  Info,
  List,
  MagnifyingGlass,
  Microphone,
  Plus,
  Stop,
  Warning,
  Wrench,
  X,
  XCircle,
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

"use client";

import type { KeyboardEvent } from "react";
import { useAppShellMobile } from "@astryxdesign/core/AppShell";
import { Avatar } from "@astryxdesign/core/Avatar";
import { DropdownMenu, DropdownMenuDivider, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@astryxdesign/core/DropdownMenu";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { InputGroup, InputGroupText } from "@astryxdesign/core/InputGroup";
import { Kbd } from "@astryxdesign/core/Kbd";
import { NavIcon } from "@astryxdesign/core/NavIcon";
import { SideNavCollapseButton } from "@astryxdesign/core/SideNav";
import { HStack, Stack } from "@astryxdesign/core/Stack";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TopNav, TopNavHeading } from "@astryxdesign/core/TopNav";
import { useAssistant } from "@/components/ai/AssistantProvider";
import { AssistantIcon, KeyboardIcon, QuestionIcon, SearchIcon, SquaresFourIcon } from "@/themes/catppuccin/icons";
import { COLOR_SCHEME_LABELS, isColorScheme, setColorScheme, useColorScheme, type ColorScheme } from "./color-scheme";
import { COLOR_SCHEME_ICONS } from "./shell-icons";
import { useShell } from "./TesseraShell";

/** The account the app runs as; the local install has one user (src/lib/tessera/actors.ts). */
const ACCOUNT_NAME = "You";

/** Keys that open Power K from the search field: Enter, Space, the arrow down and any printable character. */
function opensSearch(event: KeyboardEvent<HTMLInputElement>): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") return true;
  return event.key.length === 1;
}

/**
 * The search field in the middle of the top bar. It is a read-only field that
 * opens Power K (the same path as `mod+k`) on a click or on the keys a user
 * would type into it, so the field never holds a query of its own and focus
 * comes back to it when the palette closes. A printable key becomes the
 * palette's first query. The group and field labels join into one name,
 * "Search work items and commands".
 */
function SearchTrigger({ onOpen }: { onOpen: (initialQuery?: string) => void }) {
  return (
    <Stack className="tessera-topbar-search" onClick={() => onOpen()}>
      <InputGroup label="Search" isLabelHidden size="sm">
        <TextInput
          label="work items and commands"
          isLabelHidden
          aria-haspopup="dialog"
          isReadOnly
          size="sm"
          value=""
          startIcon={SearchIcon}
          placeholder="Search work items, or type a command"
          onKeyDown={(event) => {
            if (!opensSearch(event)) return;
            event.preventDefault();
            onOpen(event.key.length === 1 && event.key !== " " ? event.key : undefined);
          }}
        />
        <InputGroupText>
          <Kbd keys="mod+k" />
        </InputGroupText>
      </InputGroup>
    </Stack>
  );
}

/** Assistant toggle. Hidden until `GET /api/ai/status` says the assistant is available. */
function AssistantButton() {
  const { status, toggle } = useAssistant();
  if (status?.available !== true) return null;
  return <IconButton label="Assistant" variant="ghost" size="sm" tooltip="Assistant (mod+j)" icon={<Icon icon={AssistantIcon} />} onClick={toggle} />;
}

/** The account menu behind the avatar: colour scheme and keyboard shortcuts. */
function AccountMenu({ onShortcuts }: { onShortcuts: () => void }) {
  const scheme = useColorScheme();
  return (
    <DropdownMenu
      alignment="end"
      hasChevron={false}
      menuWidth={240}
      renderTrigger={(triggerProps) => (
        <IconButton
          {...triggerProps}
          label="Account and preferences"
          variant="ghost"
          size="sm"
          tooltip={ACCOUNT_NAME}
          icon={<Avatar name={ACCOUNT_NAME} size="xsm" tooltip={false} />}
        />
      )}
    >
      <DropdownMenuRadioGroup
        label="Colour scheme"
        value={scheme}
        onChange={(value) => {
          if (isColorScheme(value)) setColorScheme(value);
        }}
      >
        {(Object.keys(COLOR_SCHEME_LABELS) as ColorScheme[]).map((value) => (
          <DropdownMenuRadioItem key={value} value={value} label={COLOR_SCHEME_LABELS[value]} icon={COLOR_SCHEME_ICONS[value]} />
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuDivider />
      <DropdownMenuItem label="Keyboard shortcuts" icon={KeyboardIcon} endContent={<Kbd keys="mod+/" />} onClick={onShortcuts} />
    </DropdownMenu>
  );
}

/**
 * Top bar of the Tessera frame (docs/contracts/ui.md "Shell"), on the wash
 * above the sidebar and the content panel: the sidebar toggle and the
 * Tessera brand (home link) on the left, the search field in the middle, and
 * the assistant (when it is available), help and the account menu on the right. Below the AppShell's mobile
 * breakpoint the shell's own drawer toggle replaces the sidebar toggle.
 */
export function TopBar() {
  const { isNavCollapsed, setNavCollapsed, openCommandBar, openShortcuts } = useShell();
  const { isMobile } = useAppShellMobile();
  return (
    <TopNav
      label="Tessera"
      heading={
        <HStack gap={1} vAlign="center">
          {isMobile ? null : <SideNavCollapseButton size="sm" collapsible={{ isCollapsed: isNavCollapsed, onCollapsedChange: setNavCollapsed }} />}
          <TopNavHeading heading="Tessera" headingHref="/home" logo={<NavIcon icon={<Icon icon={SquaresFourIcon} size="sm" />} />} />
        </HStack>
      }
      centerContent={<SearchTrigger onOpen={openCommandBar} />}
      endContent={
        <HStack gap={1} vAlign="center">
          <AssistantButton />
          <IconButton label="Help and keyboard shortcuts" variant="ghost" size="sm" tooltip="Keyboard shortcuts" icon={<Icon icon={QuestionIcon} />} onClick={openShortcuts} />
          <AccountMenu onShortcuts={openShortcuts} />
        </HStack>
      }
    />
  );
}

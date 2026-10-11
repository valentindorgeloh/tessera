"use client";

/**
 * Inline "add a work item here" row at the end of a group or column
 * (docs/contracts/ui.md "Quick-add"). Idle it is a ghost button; active it is
 * a small text input: Enter creates and keeps the input focused for the next
 * item, Escape cancels, leaving it empty collapses it again.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack } from "@astryxdesign/core/Stack";
import { TextInput } from "@astryxdesign/core/TextInput";
import { PlusIcon } from "@/themes/catppuccin/icons";

export type QuickAddProps = {
  onSubmit: (name: string) => void;
  /** Button and accessible label. */
  label?: string;
  placeholder?: string;
  /** Start in the editing state (board columns open it from a header button). */
  defaultIsActive?: boolean;
};

export function QuickAdd({ onSubmit, label = "New work item", placeholder = "Work item name, then Enter", defaultIsActive = false }: QuickAddProps) {
  const [isActive, setActive] = useState(defaultIsActive);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // Counts creates. The effect below puts the caret back after each one, so the next name can be
  // typed at once even when the create's re-renders (the optimistic row, then the server's refresh)
  // moved focus elsewhere; a focused input is also what lets Escape reach this row.
  const [submitCount, setSubmitCount] = useState(0);

  useEffect(() => {
    if (submitCount > 0) inputRef.current?.focus();
  }, [submitCount]);

  if (!isActive) {
    return (
      <HStack className="tessera-wi-quickadd" vAlign="center">
        <Button variant="ghost" size="sm" icon={<Icon icon={PlusIcon} size="sm" />} label={label} onClick={() => setActive(true)} />
      </HStack>
    );
  }

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setName("");
    setSubmitCount((count) => count + 1);
  };

  const cancel = () => {
    setName("");
    setActive(false);
  };

  return (
    <HStack className="tessera-wi-quickadd tessera-wi-quickadd-active" vAlign="center" gap={2}>
      <TextInput
        ref={inputRef}
        label={label}
        isLabelHidden
        size="sm"
        width="100%"
        value={name}
        onChange={setName}
        placeholder={placeholder}
        hasAutoFocus
        onEnter={submit}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancel();
          }
        }}
        onBlur={() => {
          // The field's own value rather than the `name` closure: a blur that lands between a
          // submit and its re-render would otherwise still see the name just submitted and leave
          // the row open with nothing focused.
          if ((inputRef.current?.value ?? "").trim() === "") setActive(false);
        }}
      />
    </HStack>
  );
}

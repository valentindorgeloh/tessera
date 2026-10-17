"use client";

import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { DateInput } from "@astryxdesign/core/DateInput";
import { Popover } from "@astryxdesign/core/Popover";
import { VStack } from "@astryxdesign/core/Stack";
import { CalendarIcon } from "@/themes/catppuccin/icons";
import { formatShortDate } from "./date-format";

// Moved to the directive-free date-format.ts (P3); re-exported so current importers keep working.
export { formatShortDate };

export type DateControlProps = {
  /** YYYY-MM-DD or null. */
  value: string | null;
  onChange: (date: string | null) => void;
  /** Ghost chip that opens the picker in a popover, for list rows and table cells. */
  compact?: boolean;
  readOnly?: boolean;
  /** "Start date" or "Target date"; hidden visually. */
  label?: string;
  /** Lower bound for a target date (the item's start date). */
  min?: string | null;
  /** Upper bound for a start date (the item's target date). */
  max?: string | null;
};

type IsoDate = Parameters<typeof DateInput>[0]["value"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Narrow a stored `YYYY-MM-DD` string to DateInput's template type; undefined for null or malformed values. */
function asIsoDate(value: string | null | undefined): IsoDate {
  // The engine validates dates with IsoDateSchema, so the regex only guards against bad rows.
  return value && ISO_DATE.test(value) ? (value as NonNullable<IsoDate>) : undefined;
}

/** Date picker for start or target dates; clearing sends null so the field is unset. */
export function DateControl({ value, onChange, compact = false, readOnly = false, label = "Date", min, max }: DateControlProps) {
  const [isOpen, setOpen] = useState(false);
  const picker = (
    <DateInput
      label={label}
      isLabelHidden={compact}
      size="md"
      value={asIsoDate(value)}
      onChange={(next) => {
        onChange(next ?? null);
        if (compact) setOpen(false);
      }}
      isDisabled={readOnly}
      hasClear
      format="date"
      placeholder={label}
      min={asIsoDate(min)}
      max={asIsoDate(max)}
    />
  );
  if (!compact) return picker;
  const short = label.replace(/ date$/i, "");
  return (
    <Popover isOpen={isOpen} onOpenChange={setOpen} content={<VStack padding={3}>{picker}</VStack>} label={label} placement="below" alignment="start" hasAutoFocus>
      <Button
        variant="ghost"
        size="sm"
        className="tessera-wi-chip"
        icon={<CalendarIcon />}
        label={value ? `${short} ${formatShortDate(value)}` : label}
        isIconOnly={!value}
        tooltip={value ? `${label}: ${value}` : `Set ${label.toLowerCase()}`}
        isDisabled={readOnly}
      />
    </Popover>
  );
}

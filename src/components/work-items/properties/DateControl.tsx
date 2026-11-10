"use client";

import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { DateInput } from "@astryxdesign/core/DateInput";
import { Popover } from "@astryxdesign/core/Popover";
import { VStack } from "@astryxdesign/core/Stack";
import { useWeekStart } from "@/components/workspace-settings/workspace-settings-store";
import { CalendarIcon } from "@/themes/catppuccin/icons";
import { useProjectRow } from "../project-provider";
import { PropertyChip, useArmed, useArmedHandoff } from "./arming";
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
  /** The compact chip shows an overdue date in the error text colour (`data-overdue`, work-items.css); see isOverdue. */
  isOverdue?: boolean;
  /** The compact chip keeps its label while empty ("Start date") instead of a bare calendar icon, for forms. */
  hasEmptyLabel?: boolean;
  /** Names this control to a row that arms (./arming.tsx); a row without arming leaves it out. */
  armKey?: string;
};

type IsoDate = Parameters<typeof DateInput>[0]["value"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Narrow a stored `YYYY-MM-DD` string to DateInput's template type; undefined for null or malformed values. */
function asIsoDate(value: string | null | undefined): IsoDate {
  // The engine validates dates with IsoDateSchema, so the regex only guards against bad rows.
  return value && ISO_DATE.test(value) ? (value as NonNullable<IsoDate>) : undefined;
}

/**
 * Date picker for start or target dates; clearing sends null so the field is unset. A compact chip of a row (`armKey`)
 * that has not armed, or that is read-only and so can never open, is the plain button alone: no popover layer and no
 * calendar.
 */
export function DateControl(props: DateControlProps) {
  const { compact = false, readOnly = false, label = "Date", value, isOverdue = false, hasEmptyLabel = false, armKey } = props;
  const { bundle } = useProjectRow();
  const { armed, arm } = useArmed();
  if (compact && armKey !== undefined && (readOnly || !armed)) {
    const short = label.replace(/ date$/i, "");
    return (
      <PropertyChip
        label={value ? `${short} ${formatShortDate(value, bundle.today)}` : label}
        armKey={armKey}
        arm={arm}
        icon={<CalendarIcon />}
        isIconOnly={!value && !hasEmptyLabel}
        isDisabled={readOnly}
        isOverdue={isOverdue && value !== null}
      />
    );
  }
  return <DatePicker {...props} />;
}

function DatePicker({ value, onChange, compact = false, readOnly = false, label = "Date", min, max, isOverdue = false, hasEmptyLabel = false, armKey }: DateControlProps) {
  const { isDefaultOpen, takeFocus } = useArmedHandoff(armKey);
  // The arming click was aimed at this control's chip: the popover starts open (the state starts here, so it applies once).
  const [isOpen, setOpen] = useState(isDefaultOpen);
  const { bundle } = useProjectRow();
  const weekStartsOn = useWeekStart(bundle.week_start);
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
      weekStartsOn={weekStartsOn}
      presentation="popover"
    />
  );
  if (!compact) return picker;
  const short = label.replace(/ date$/i, "");
  // Astryx 0.6.8 Popover has no lazy prop and keeps closed content mounted: every closed chip carried a full DateInput
  // calendar (two per row with both dates shown). The picker mounts only while the popover is open.
  return (
    <Popover isOpen={isOpen} onOpenChange={setOpen} content={isOpen ? <VStack padding={3}>{picker}</VStack> : null} label={label} placement="below" alignment="start" hasAutoFocus>
      <Button
        ref={takeFocus}
        variant="ghost"
        size="sm"
        className="tessera-wi-chip"
        data-overdue={isOverdue && value ? "" : undefined}
        icon={<CalendarIcon />}
        label={value ? `${short} ${formatShortDate(value, bundle.today)}` : label}
        isIconOnly={!value && !hasEmptyLabel}
        tooltip={value ? `${label}: ${value}` : `Set ${label.toLowerCase()}`}
        isDisabled={readOnly}
      />
    </Popover>
  );
}

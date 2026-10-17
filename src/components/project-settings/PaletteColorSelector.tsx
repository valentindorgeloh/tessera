"use client";

/**
 * Colour selector over the ten palette colours (docs/drafts/p4-ui.md "Shared
 * pieces"): every option and the trigger show the colour as a Token, as
 * `CreateProjectDialog` does. Used by General, the state, label and actor dialogs.
 */
import { Selector, type SelectorOptionData } from "@astryxdesign/core/Selector";
import { Token } from "@astryxdesign/core/Token";
import { PaletteColorSchema } from "@/lib/tessera/schemas";
import type { PaletteColor } from "@/lib/tessera/types";
import { PALETTE_COLOR_LABELS } from "./palette-labels";

export type PaletteColorSelectorProps = {
  label: string;
  value: PaletteColor;
  onChange: (value: PaletteColor) => void;
  isDisabled?: boolean;
  size?: "sm" | "md";
};

const OPTIONS: SelectorOptionData[] = PaletteColorSchema.options.map((value) => ({ value, label: PALETTE_COLOR_LABELS[value] }));

function isPaletteColor(value: string): value is PaletteColor {
  return (PaletteColorSchema.options as readonly string[]).includes(value);
}

function renderColor(option: SelectorOptionData) {
  const color = isPaletteColor(option.value) ? option.value : "gray";
  return <Token label={PALETTE_COLOR_LABELS[color]} color={color} size="sm" />;
}

export function PaletteColorSelector({ label, value, onChange, isDisabled = false, size = "md" }: PaletteColorSelectorProps) {
  return (
    <Selector
      label={label}
      size={size}
      options={OPTIONS}
      value={value}
      isDisabled={isDisabled}
      onChange={(next) => isPaletteColor(next) && onChange(next)}
      renderOption={renderColor}
      renderValue={renderColor}
    />
  );
}

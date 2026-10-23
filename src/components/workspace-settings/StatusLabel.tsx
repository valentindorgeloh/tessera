"use client";

/**
 * A status as a dot and its word. The dot alone carries the status by colour
 * only (Astryx: always pair a StatusDot with a visible label), so the exports
 * and webhook delivery tables show the label beside it.
 */
import { HStack } from "@astryxdesign/core/Stack";
import { StatusDot, type StatusDotProps } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";

export type StatusLabelProps = {
  variant: StatusDotProps["variant"];
  label: string;
};

export function StatusLabel({ variant, label }: StatusLabelProps) {
  return (
    <HStack gap={2} vAlign="center">
      <StatusDot variant={variant} label={label} />
      <Text color="secondary">{label}</Text>
    </HStack>
  );
}

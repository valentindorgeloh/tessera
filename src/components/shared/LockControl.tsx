"use client";

/**
 * Lock toggle with brief feedback: a locked item shows the lock and "Locked";
 * on unlock the unlock icon and "Unlocked" show once and fade, then the
 * button returns to the plain lock icon. `isLocked` is the displayed state
 * (server value plus the optimistic flip, see use-optimistic-lock.ts). The
 * feedback follows `confirmedLocked`, the server value, never the optimistic
 * flip: a failed unlock rolls the display back, and that rollback is not a
 * change worth confirming. The feedback is derived while rendering and ends
 * on the animation's own event, so no effect or timer is involved. The motion
 * lives in
 * styles/lock-control.css and is cut short under prefers-reduced-motion.
 */
import { useState } from "react";
import { IconButton } from "@astryxdesign/core/IconButton";
import type { IconButtonProps } from "@astryxdesign/core/IconButton";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { LockIcon, UnlockIcon } from "@/themes/catppuccin/icons";
import { nextLockFeedback, type LockFeedback } from "./lock-state";

export type LockControlProps = {
  /** Whether the item is currently locked (the displayed, possibly optimistic, state). */
  isLocked: boolean;
  /**
   * The server's lock state (no optimistic flip). The "Unlocked" feedback fires
   * when this changes from locked to unlocked, so an optimistic unlock that
   * rolls back shows nothing. Defaults to `isLocked`.
   */
  confirmedLocked?: boolean;
  /** Toggles the lock. */
  onToggle: () => void;
  size?: IconButtonProps["size"];
  variant?: IconButtonProps["variant"];
  /** Accessible label; defaults to the action the button performs. */
  label?: string;
  tooltip?: string;
  isDisabled?: boolean;
  className?: string;
};

export function LockControl({ isLocked, confirmedLocked = isLocked, onToggle, size = "sm", variant = "ghost", label, tooltip, isDisabled = false, className }: LockControlProps) {
  // Adjusting state while rendering (React's documented pattern) instead of an effect.
  const [seenLocked, setSeenLocked] = useState(confirmedLocked);
  const [feedback, setFeedback] = useState<LockFeedback>("idle");
  if (seenLocked !== confirmedLocked) {
    setSeenLocked(confirmedLocked);
    setFeedback(nextLockFeedback(seenLocked, confirmedLocked, feedback));
  }

  const action = isLocked ? "Unlock" : "Lock";
  const buttonProps = { size, variant, onClick: onToggle, isDisabled, label: label ?? action, tooltip: tooltip ?? action };

  if (isLocked) {
    return (
      <HStack gap={1} vAlign="center" className={className}>
        <IconButton {...buttonProps} icon={<LockIcon className="tessera-lock-icon-in" />} />
        <Text type="supporting" size="sm" weight="medium" className="tessera-lock-text-in tessera-lock-pill">
          Locked
        </Text>
      </HStack>
    );
  }
  if (feedback === "unlocked") {
    return (
      <HStack gap={1} vAlign="center" className={className}>
        <IconButton {...buttonProps} icon={<UnlockIcon className="tessera-unlock-icon-in" />} />
        <Text type="supporting" size="sm" weight="medium" className="tessera-lock-text-out" onAnimationEnd={() => setFeedback("idle")}>
          Unlocked
        </Text>
      </HStack>
    );
  }
  return <IconButton {...buttonProps} icon={<LockIcon />} className={className} />;
}

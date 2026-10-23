"use client";

/**
 * Reactions on a work item's description or on a comment (decision 57,
 * docs/contracts/ui.md "Detail components"): the existing reactions as toggle chips
 * with their counts (`aria-pressed` for the user's own, named "<emoji name>
 * reaction, N") and an add-reaction button that opens the eight emoji. A click
 * toggles optimistically (decision 13: `useOptimistic` in a transition; a
 * failure reverts the chip and toasts). Read-only on an archived item: the
 * chips stay, disabled, with no add button, and a bar with nothing to show
 * renders nothing.
 */
import { startTransition, useOptimistic, useState } from "react";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Popover } from "@astryxdesign/core/Popover";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { addReactionAction, removeReactionAction } from "@/app/actions/relations-comments";
import { SmileyIcon } from "@/themes/catppuccin/icons";
import { REACTION_CHOICES, hasReacted, isReactionEmoji, reactionChipLabel, toggleReaction, type ReactionEmoji, type ReactionSummary } from "./reaction-model";
import { useActionRunner } from "./use-detail-actions";

export type ReactionBarProps = {
  target: "work_item" | "comment";
  targetId: string;
  reactions: readonly ReactionSummary[];
  currentActorId: string;
  readOnly?: boolean;
  /** Names the bar for assistive tech: "Reactions to the description", "Reactions to the comment by Ada". */
  label?: string;
};

export function ReactionBar({ target, targetId, reactions, currentActorId, readOnly = false, label = "Reactions" }: ReactionBarProps) {
  const { fail } = useActionRunner();
  const [view, applyToggle] = useOptimistic(reactions, (current: readonly ReactionSummary[], emoji: string) => toggleReaction(current, emoji, currentActorId));
  const [isPickerOpen, setPickerOpen] = useState(false);

  const toggle = (emoji: ReactionEmoji) => {
    // Read from the optimistic view, so a second click right after the first takes the first one back.
    const isMine = hasReacted(view, emoji, currentActorId);
    startTransition(async () => {
      applyToggle(emoji);
      const action = isMine ? removeReactionAction : addReactionAction;
      const result = await action({ target, target_id: targetId, reaction: emoji });
      if (!result.ok) fail(`Could not ${isMine ? "remove" : "add"} the reaction: ${result.message}`);
    });
  };

  const chips = view.filter((summary) => isReactionEmoji(summary.reaction));
  if (readOnly && chips.length === 0) return null;
  const picker = (
    <HStack gap={1} role="group" aria-label="Choose a reaction" className="tessera-reaction-picker">
      {REACTION_CHOICES.map((choice) => (
        <ToggleButton
          key={choice.emoji}
          size="md"
          isIconOnly
          isPressed={hasReacted(view, choice.emoji, currentActorId)}
          label={`React with ${choice.name}`}
          icon={<Text type="inherit">{choice.emoji}</Text>}
          onPressedChange={() => {
            setPickerOpen(false);
            toggle(choice.emoji);
          }}
        />
      ))}
    </HStack>
  );
  return (
    <HStack gap={2} vAlign="center" role="group" aria-label={label} className="tessera-reactions">
      {chips.map((summary) => {
        if (!isReactionEmoji(summary.reaction)) return null;
        const name = reactionChipLabel(summary.reaction, summary.count);
        return (
          <ToggleButton
            key={summary.reaction}
            size="sm"
            label={name}
            aria-label={name}
            isPressed={summary.actor_ids.includes(currentActorId)}
            isDisabled={readOnly}
            onPressedChange={() => toggle(summary.reaction as ReactionEmoji)}
            className="tessera-reaction tessera-hit"
          >
            <HStack gap={1} vAlign="center">
              <Text type="inherit">{summary.reaction}</Text>
              <Text type="supporting" color="secondary" hasTabularNumbers>
                {summary.count}
              </Text>
            </HStack>
          </ToggleButton>
        );
      })}
      {readOnly ? null : (
        <Popover isOpen={isPickerOpen} onOpenChange={setPickerOpen} content={picker} label="Add reaction" placement="below" alignment="start" hasAutoFocus>
          <IconButton variant="ghost" size="sm" label="Add reaction" icon={<Icon icon={SmileyIcon} size="sm" />} className="tessera-hit tessera-hit-x" />
        </Popover>
      )}
    </HStack>
  );
}

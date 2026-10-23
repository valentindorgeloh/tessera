/**
 * Pure model of the reaction bar (decision 57): the eight emoji with their
 * spoken names, the chip's accessible name, and the optimistic toggle. No
 * React, so Vitest covers it directly (tests/ui/reaction-bar.test.ts).
 * The emoji list repeats REACTION_EMOJI of the engine (`reactions.ts` pulls in
 * the database layer, which client code may not import); a test keeps the two
 * equal.
 */

export type ReactionSummary = { reaction: string; count: number; actor_ids: string[] };

export const REACTION_CHOICES = [
  { emoji: "👍", name: "thumbs up" },
  { emoji: "👎", name: "thumbs down" },
  { emoji: "😄", name: "smile" },
  { emoji: "🎉", name: "party popper" },
  { emoji: "😕", name: "confused" },
  { emoji: "❤️", name: "heart" },
  { emoji: "🚀", name: "rocket" },
  { emoji: "👀", name: "eyes" },
] as const;

export type ReactionEmoji = (typeof REACTION_CHOICES)[number]["emoji"];

const ORDER = new Map<string, number>(REACTION_CHOICES.map((choice, index) => [choice.emoji, index]));
const NAMES = new Map<string, string>(REACTION_CHOICES.map((choice) => [choice.emoji, choice.name]));

export function isReactionEmoji(value: string): value is ReactionEmoji {
  return ORDER.has(value);
}

/** Spoken name of an emoji ("thumbs up"); the emoji itself for one outside the set. */
export function reactionName(emoji: string): string {
  return NAMES.get(emoji) ?? emoji;
}

/** Accessible name of a chip: "thumbs up reaction, 2". */
export function reactionChipLabel(emoji: string, count: number): string {
  return `${reactionName(emoji)} reaction, ${count}`;
}

export function hasReacted(summaries: readonly ReactionSummary[], emoji: string, actorId: string): boolean {
  return summaries.some((summary) => summary.reaction === emoji && summary.actor_ids.includes(actorId));
}

/**
 * The summaries after `actorId` toggles `emoji`: a reaction the actor has is
 * taken back (a count that reaches zero drops the chip), otherwise it is
 * added. Chips keep the engine's emoji order.
 */
export function toggleReaction(summaries: readonly ReactionSummary[], emoji: string, actorId: string): ReactionSummary[] {
  const existing = summaries.find((summary) => summary.reaction === emoji);
  if (existing && existing.actor_ids.includes(actorId)) {
    const actor_ids = existing.actor_ids.filter((id) => id !== actorId);
    if (actor_ids.length === 0) return summaries.filter((summary) => summary !== existing);
    return summaries.map((summary) => (summary === existing ? { ...summary, actor_ids, count: actor_ids.length } : summary));
  }
  if (existing) {
    const actor_ids = [...existing.actor_ids, actorId];
    return summaries.map((summary) => (summary === existing ? { ...summary, actor_ids, count: actor_ids.length } : summary));
  }
  const next = [...summaries, { reaction: emoji, count: 1, actor_ids: [actorId] }];
  return next.sort((a, b) => (ORDER.get(a.reaction) ?? 0) - (ORDER.get(b.reaction) ?? 0));
}

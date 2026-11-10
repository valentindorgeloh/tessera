/**
 * Where the drop settle starts horizontally (docs/contracts/ui.md "Motion"). The dropped card sits inside its column
 * body (`.tessera-board-column-body`, a scroller) or, in a swimlane, inside the lane's cell (`.tessera-board-cell`,
 * `overflow: clip`); both pad their cards by 8px and clip whatever leaves them. The offset from the drag overlay to the
 * slot is the whole distance the pointer travelled, so a drop near the column's edge started the glide with part of
 * the card cut off, or all of it, until it had slid back inside. The start is clamped so the card's box begins inside
 * that body: the glide then shows the whole card from its first frame. Because a card fills its body but for the
 * padding, the horizontal travel is the padding at most; the glide is mostly vertical.
 */

/** The horizontal edges of a rectangle, in viewport coordinates. */
export type Edges = { left: number; right: number };

/**
 * `rawX` is the overlay's left edge minus the slot's. `clip` is the body the card is clipped by, or null when it has
 * none: the offset stays as it is. A slot wider than its clip cannot be made to fit, so the card starts in its slot.
 */
export function settleStartX(rawX: number, slot: Edges, clip: Edges | null | undefined): number {
  if (!clip) return rawX;
  const least = clip.left - slot.left;
  const most = clip.right - slot.right;
  if (least > most) return 0;
  return Math.min(Math.max(rawX, least), most);
}

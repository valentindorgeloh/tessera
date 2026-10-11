/**
 * Date-only formatting shared by property controls and the planning screens
 * (docs/contracts/ui.md "P3", mismatch 27). No directive: Server Components
 * and Vitest import it without pulling a client file.
 */

/** "Nov 10" (with the year when it is not the current one); fixed locale so server and client agree. */
export function formatShortDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const sameYear = year === new Date().getFullYear();
  return date.toLocaleDateString("en-US", sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

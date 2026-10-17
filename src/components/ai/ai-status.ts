/**
 * Copy for a missing assistant (docs/drafts/p5-plan.md §6). Every entry point
 * stays hidden unless `available` is true; an open panel explains why.
 */
import type { AiStatus } from "@/lib/tessera/types";

export type { AiStatus };

/** Banner title and description for an unavailable status. */
export function assistantUnavailableCopy(status: Extract<AiStatus, { available: false }>): { title: string; description: string } {
  if (status.reason === "no_credential") {
    return {
      title: "Assistant unavailable",
      description: "Run ant auth login, or set ANTHROPIC_API_KEY in .env.local.",
    };
  }
  if (status.reason === "model_unavailable") {
    return { title: "Assistant unavailable", description: "The configured model is unavailable." };
  }
  return { title: "Assistant unavailable", description: "The assistant could not be reached." };
}

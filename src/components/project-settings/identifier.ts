/**
 * Project identifier helpers for the General settings tab (docs/drafts/p4-ui.md
 * "General"): the same shape as `CreateProjectDialog`'s identifier field.
 */
import { PROJECT_IDENTIFIER_PATTERN } from "@/lib/tessera/schemas";

/** Upper-case, drop everything but A-Z and 0-9, cap at 12 characters. */
export function sanitizeIdentifier(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
}

/** The message for an identifier the engine would refuse (decision 3: 2-12 letters or digits, starting with a letter); null when it is valid. */
export function identifierError(value: string): string | null {
  return PROJECT_IDENTIFIER_PATTERN.test(value) ? null : "Use 2–12 letters or digits, starting with a letter";
}

"use client";

/**
 * Pieces of a settings row (states, labels, actors, features, webhooks): a
 * ListItem takes a plain-string label and description, which Astryx weights 400
 * and truncates to one line. These two give the row its look instead: the name
 * 14/500 (plane-visual-reference section 14) and a helper line that wraps, so a
 * narrow row reads in full. `tessera-settings-title` is what
 * `tessera-settings-row--wrap` (project-settings.css) keys its wrapping on.
 */
import type { ReactNode } from "react";
import { Text } from "@astryxdesign/core/Text";

/** The row's name. `maxLines` clamps a name that must stay on one line (a state, a label); the default wraps. */
export function SettingsTitle({ children, maxLines }: { children: ReactNode; maxLines?: number }) {
  return (
    <Text weight="medium" maxLines={maxLines} className="tessera-settings-title">
      {children}
    </Text>
  );
}

/** The row's helper line: supporting size, secondary colour, wraps. */
export function SettingsHelp({ children }: { children: ReactNode }) {
  return (
    <Text type="supporting" color="secondary">
      {children}
    </Text>
  );
}

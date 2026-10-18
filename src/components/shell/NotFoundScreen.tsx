"use client";

import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { VStack } from "@astryxdesign/core/Stack";
import { CompassIcon } from "@/themes/catppuccin/icons";
import { useMissingRoute } from "./recents-store";

/**
 * The Tessera "page not found" screen, shared by the root and route group
 * `not-found.tsx` files and by the project segment's boundary when the project
 * itself is unknown, centred in whatever area hosts it. A client component
 * because the Phosphor glyphs in src/themes/catppuccin/icons.tsx create a React
 * context at module load, which React Server Components cannot evaluate.
 * The address leaves the recents (`useMissingRoute`).
 */
export function NotFoundScreen() {
  useMissingRoute();
  return (
    <VStack padding={8} minHeight="100%" hAlign="center" vAlign="center">
      <EmptyState
        icon={<Icon icon={CompassIcon} size="lg" color="secondary" />}
        title="Page not found"
        description="Nothing lives at this address. It may have been moved or deleted."
        actions={<Button label="Go home" variant="primary" href="/" />}
      />
    </VStack>
  );
}

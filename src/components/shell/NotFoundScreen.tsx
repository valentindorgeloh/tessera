"use client";

import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { VStack } from "@astryxdesign/core/Stack";
import { CompassIcon } from "@/themes/paper/icons";

/**
 * The Tessera "page not found" screen, shared by the route group's
 * `not-found.tsx` and by the project segment's boundary when the project
 * itself is unknown. A client component because the Phosphor glyphs in
 * src/themes/paper/icons.tsx create a React context at module load, which
 * React Server Components cannot evaluate.
 */
export function NotFoundScreen() {
  return (
    <VStack padding={8} hAlign="center">
      <EmptyState
        icon={<Icon icon={CompassIcon} size="lg" color="secondary" />}
        title="Page not found"
        description="Nothing lives at this address. It may have been moved or deleted."
        actions={<Button label="Go home" variant="primary" href="/home" />}
      />
    </VStack>
  );
}

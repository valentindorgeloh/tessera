"use client";

import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { WarningIcon } from "@/themes/paper/icons";

/** Error boundary for every Tessera route outside a project (docs/PLAN.md section 6). */
export default function TesseraError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <VStack padding={8} hAlign="center">
      <EmptyState
        icon={<Icon icon={WarningIcon} size="lg" color="warning" />}
        title="Something went wrong"
        description={error.digest ? `Reference ${error.digest}` : error.message}
        actions={
          <HStack gap={2}>
            <Button label="Try again" variant="primary" onClick={() => retry()} />
            <Button label="Go home" variant="secondary" href="/home" />
          </HStack>
        }
      />
    </VStack>
  );
}

import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";

/** The chat pages' fallback while their reads stream in. */
export function ChatSkeleton() {
  return (
    <VStack gap={3} padding={4} aria-busy="true" aria-label="Loading superagent chat">
      <Skeleton height="var(--size-element-md)" width="30%" />
      <Skeleton height="var(--size-element-lg)" index={1} />
      <Skeleton height="var(--size-element-lg)" index={2} />
      <Skeleton height="var(--size-element-lg)" index={3} />
    </VStack>
  );
}

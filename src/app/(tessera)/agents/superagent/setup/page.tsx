import { Suspense } from "react";
import { headers } from "next/headers";
import { io } from "next/cache";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { tesseraUrlFromHost } from "@/components/superagent/setup-status";
import { SetupGuideScreen } from "@/components/superagent/setup/SetupGuideScreen";
import { loadSuperagentSetup } from "@/lib/superagent/setup";

/**
 * `/agents/superagent/setup` (decision 155; docs/contracts/ui.md "Superagent control", "Setup guide"): the guide
 * that takes a Tessera user through setting up the runner. A static segment, so it wins over
 * `agents/[actorId]/[tab]`. `headers()` is read under Suspense, only to show this Tessera's port in step 9.
 */
export default function SuperagentSetupPage() {
  return (
    <Suspense fallback={<SetupSkeleton />}>
      <SetupData />
    </Suspense>
  );
}

async function SetupData() {
  await io();
  const [load, requestHeaders] = await Promise.all([loadSuperagentSetup(), headers()]);
  return <SetupGuideScreen load={load} tesseraUrl={tesseraUrlFromHost(requestHeaders.get("host"))} />;
}

function SetupSkeleton() {
  return (
    <VStack gap={3} padding={4} aria-busy="true" aria-label="Loading setup guide">
      <Skeleton height="var(--size-element-md)" width="30%" />
      <Skeleton height="var(--size-element-lg)" index={1} />
      <Skeleton height="var(--size-element-lg)" index={2} />
      <Skeleton height="var(--size-element-lg)" index={3} />
    </VStack>
  );
}

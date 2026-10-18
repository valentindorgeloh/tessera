import { Suspense } from "react";
import { io } from "next/cache";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { PanelBar, PanelHeader, PanelPage, PanelTitle } from "@/components/shell/PanelHeader";
import { WebhooksScreen } from "@/components/webhooks/WebhooksScreen";
import { listWebhooks, readTessera } from "@/lib/tessera/server";

/** Workspace outbound webhooks (docs/drafts/p10-plan.md U2). */
export default function WebhooksSettingsPage() {
  return (
    <Suspense fallback={<WebhooksFallback />}>
      <WebhooksBody />
    </Suspense>
  );
}

async function WebhooksBody() {
  await io();
  const webhooks = await readTessera((ctx) => listWebhooks(ctx));
  return <WebhooksScreen webhooks={webhooks} />;
}

function WebhooksFallback() {
  return (
    <PanelPage
      width="reading"
      header={
        <PanelHeader label="Settings">
          <PanelBar start={<PanelTitle>Settings</PanelTitle>} />
        </PanelHeader>
      }
    >
      <VStack gap={4} padding={6} aria-busy="true" aria-label="Loading webhooks">
        <Skeleton height="var(--size-element-md)" width="40%" />
        <Skeleton height="var(--size-element-lg)" index={1} />
      </VStack>
    </PanelPage>
  );
}

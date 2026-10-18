import { Suspense } from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { PanelBar, PanelHeader, PanelPage, PanelTitle } from "@/components/shell/PanelHeader";
import { WebhookScreen } from "@/components/webhooks/WebhookScreen";
import { IdSchema } from "@/lib/tessera/schemas";
import { listWebhookDeliveries, listWebhooks, readTessera } from "@/lib/tessera/server";

type Props = { params: Promise<{ webhookId: string }> };

/** One webhook and its recent deliveries (docs/drafts/p10-plan.md U2). */
export default function WebhookDetailPage({ params }: Props) {
  return (
    <Suspense fallback={<WebhookFallback />}>
      <WebhookBody params={params} />
    </Suspense>
  );
}

async function WebhookBody({ params }: Props) {
  const { webhookId } = await params;
  if (!IdSchema.safeParse(webhookId).success) notFound();
  await io();
  const loaded = await readTessera((ctx) => {
    const webhook = listWebhooks(ctx).find((row) => row.id === webhookId) ?? null;
    if (webhook === null) return null;
    return { webhook, deliveries: listWebhookDeliveries(ctx, { webhook_id: webhookId, limit: 50 }) };
  });
  if (loaded === null) notFound();
  return <WebhookScreen webhook={loaded.webhook} deliveries={loaded.deliveries} />;
}

function WebhookFallback() {
  return (
    <PanelPage
      width="reading"
      header={
        <PanelHeader label="Settings">
          <PanelBar start={<PanelTitle>Settings</PanelTitle>} />
        </PanelHeader>
      }
    >
      <VStack gap={4} padding={6} aria-busy="true" aria-label="Loading webhook">
        <Skeleton height="var(--size-element-md)" width="40%" />
        <Skeleton height="var(--size-element-lg)" index={1} />
      </VStack>
    </PanelPage>
  );
}

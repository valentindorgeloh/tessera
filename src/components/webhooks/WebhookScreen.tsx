"use client";

/**
 * One webhook: secret, rotate, test, delete, and recent deliveries.
 */
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Heading } from "@astryxdesign/core/Heading";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Table } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { useClipboard } from "@astryxdesign/core/hooks";
import {
  deleteWebhookAction,
  redeliverWebhookDeliveryAction,
  rotateWebhookSecretAction,
  testWebhookAction,
  updateWebhookAction,
} from "@/app/actions/webhooks";
import { RelativeTime } from "@/components/detail/RelativeTime";
import { AlertDialog } from "@/components/shell/dialogs";
import { registerEntityLabel } from "@/components/shell/entity-labels";
import { forgetRecentsUnder } from "@/components/shell/recents-store";
import { WorkspaceSettingsChrome } from "@/components/workspace-settings/WorkspaceSettingsChrome";
import type { WebhookDeliveryView, WebhookView } from "@/lib/tessera/types";
import { CheckIcon, CopyIcon, RetryIcon, TrashIcon, WebhookIcon } from "@/themes/catppuccin/icons";
import { WebhookDialog } from "./WebhookDialog";
import { DELIVERY_STATUS_LABEL, deliveryStatusVariant, eventsSummary } from "./webhook-format";

export type WebhookScreenProps = {
  webhook: WebhookView;
  deliveries: WebhookDeliveryView[];
};

type DeliveryRow = {
  id: string;
  event: string;
  seq: string;
  status: WebhookDeliveryView["status"];
  attempts: number;
  response: string;
  nextAttemptAt: string | null;
  lastError: string | null;
};

export function WebhookScreen({ webhook, deliveries }: WebhookScreenProps) {
  const router = useRouter();
  const toast = useToast();
  const clipboard = useClipboard({ announce: "Copied" });
  const [secret, setSecret] = useState(webhook.secret ?? "");
  const [secretFrom, setSecretFrom] = useState(webhook.secret ?? "");
  const [editOpen, setEditOpen] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    registerEntityLabel(webhook.id, webhook.name);
  }, [webhook.id, webhook.name]);

  const serverSecret = webhook.secret ?? "";
  if (serverSecret !== secretFrom) {
    setSecretFrom(serverSecret);
    if (secret === secretFrom) setSecret(serverSecret);
  }

  const rows: DeliveryRow[] = deliveries.map((row) => ({
    id: row.id,
    event: row.event,
    seq: row.activity_seq === null ? "—" : String(row.activity_seq),
    status: row.status,
    attempts: row.attempts,
    response: row.response_status === null ? "—" : String(row.response_status),
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
  }));

  const setActive = (next: boolean) => {
    startTransition(async () => {
      const result = await updateWebhookAction({ webhook_id: webhook.id, is_active: next });
      if (!result.ok) toast({ type: "error", body: `Could not update ${webhook.name}. ${result.message}` });
    });
  };

  const sendTest = () => {
    startTransition(async () => {
      const result = await testWebhookAction({ webhook_id: webhook.id });
      if (!result.ok) toast({ type: "error", body: `Could not send a test. ${result.message}` });
      else toast({ type: "info", body: "Test delivery queued" });
    });
  };

  const rotate = () => {
    startTransition(async () => {
      const result = await rotateWebhookSecretAction({ webhook_id: webhook.id });
      if (!result.ok) {
        toast({ type: "error", body: `Could not rotate the secret. ${result.message}` });
        return;
      }
      setSecret(result.data.secret ?? "");
      setRotateOpen(false);
      toast({ type: "info", body: "Secret rotated" });
    });
  };

  const remove = () => {
    startTransition(async () => {
      const result = await deleteWebhookAction({ webhook_id: webhook.id });
      if (!result.ok) {
        toast({ type: "error", body: `Could not delete ${webhook.name}. ${result.message}` });
        return;
      }
      forgetRecentsUnder(`/settings/webhooks/${webhook.id}`);
      setDeleteOpen(false);
      toast({ type: "info", body: `Deleted ${webhook.name}` });
      router.push("/settings/webhooks");
    });
  };

  const redeliver = (deliveryId: string) => {
    startTransition(async () => {
      const result = await redeliverWebhookDeliveryAction({ delivery_id: deliveryId });
      if (!result.ok) toast({ type: "error", body: `Could not redeliver. ${result.message}` });
      else toast({ type: "info", body: "Delivery queued again" });
    });
  };

  return (
    <WorkspaceSettingsChrome tab="webhooks">
      <VStack gap={6} padding={6}>
        <VStack gap={2}>
          <HStack gap={2} vAlign="center" hAlign="between">
            <Heading level={3}>{webhook.name}</Heading>
            <HStack gap={2}>
              <Button variant="secondary" size="sm" label="Edit" onClick={() => setEditOpen(true)} />
              <Button
                variant="secondary"
                size="sm"
                label={webhook.is_active ? "Deactivate" : "Activate"}
                onClick={() => setActive(!webhook.is_active)}
                isDisabled={isPending}
              />
              <Button variant="secondary" size="sm" label="Send test" onClick={sendTest} isDisabled={isPending || !webhook.is_active} />
              <Button variant="destructive" size="sm" label="Delete…" icon={<TrashIcon />} onClick={() => setDeleteOpen(true)} />
            </HStack>
          </HStack>
          <Text type="code">{webhook.url}</Text>
          <Text type="supporting" color="secondary">
            {eventsSummary(webhook.events)}
            {webhook.is_active ? "" : " · Inactive"}
          </Text>
        </VStack>

        <FormLayout>
          <HStack gap={2} vAlign="end">
            <TextInput label="Signing secret" value={secret} isReadOnly />
            <IconButton
              label={clipboard.isCopied ? "Copied" : "Copy secret"}
              tooltip={clipboard.isCopied ? "Copied" : "Copy secret"}
              variant="secondary"
              size="sm"
              icon={clipboard.isCopied ? <CheckIcon /> : <CopyIcon />}
              onClick={() => void clipboard.copy(secret)}
              isDisabled={secret === ""}
            />
            <Button variant="secondary" size="sm" label="Rotate secret" onClick={() => setRotateOpen(true)} />
          </HStack>
        </FormLayout>

        <VStack gap={3}>
          <Heading level={5}>Deliveries</Heading>
          {rows.length === 0 ? (
            <EmptyState
              icon={<Icon icon={WebhookIcon} size="lg" color="secondary" />}
              title="No deliveries yet"
              description="Send a test or wait for matching activity."
            />
          ) : (
            <Table<DeliveryRow>
              density="compact"
              idKey="id"
              data={rows}
              columns={[
                { key: "event", header: "Event", renderCell: (row) => <Text type="code">{row.event}</Text> },
                { key: "seq", header: "Seq", align: "end", renderCell: (row) => <Text hasTabularNumbers>{row.seq}</Text> },
                {
                  key: "status",
                  header: "Status",
                  renderCell: (row) => <StatusDot variant={deliveryStatusVariant(row.status)} label={DELIVERY_STATUS_LABEL[row.status]} />,
                },
                { key: "attempts", header: "Attempts", align: "end", renderCell: (row) => <Text hasTabularNumbers>{row.attempts}</Text> },
                { key: "response", header: "Response", align: "end", renderCell: (row) => <Text hasTabularNumbers>{row.response}</Text> },
                {
                  key: "next",
                  header: "Next attempt",
                  renderCell: (row) =>
                    row.nextAttemptAt ? (
                      <RelativeTime value={row.nextAttemptAt} type="supporting" color="secondary" hasTooltip={false} />
                    ) : (
                      <Text type="supporting" color="secondary">
                        —
                      </Text>
                    ),
                },
                {
                  key: "redeliver",
                  header: "",
                  align: "end",
                  renderCell: (row) => (
                    <IconButton
                      label="Redeliver"
                      variant="ghost"
                      size="sm"
                      icon={<RetryIcon />}
                      onClick={() => redeliver(row.id)}
                      isDisabled={isPending}
                    />
                  ),
                },
              ]}
            />
          )}
        </VStack>
      </VStack>

      <WebhookDialog isOpen={editOpen} onOpenChange={setEditOpen} webhook={webhook} />
      <AlertDialog
        isOpen={rotateOpen}
        onOpenChange={(open) => !isPending && setRotateOpen(open)}
        title="Rotate signing secret"
        description="The current secret stops working immediately. Update receivers before they miss deliveries."
        actionLabel="Rotate"
        isActionLoading={isPending}
        onAction={rotate}
      />
      <AlertDialog
        isOpen={deleteOpen}
        onOpenChange={(open) => !isPending && setDeleteOpen(open)}
        title="Delete webhook"
        description={`${webhook.name} is deleted. Pending deliveries are marked failed.`}
        actionLabel="Delete"
        actionVariant="destructive"
        isActionLoading={isPending}
        onAction={remove}
      />
    </WorkspaceSettingsChrome>
  );
}

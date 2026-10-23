"use client";

/**
 * One webhook: secret, rotate, test, delete, and recent deliveries.
 */
import { Fragment, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Heading } from "@astryxdesign/core/Heading";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Table, type TableColumn } from "@astryxdesign/core/Table";
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
import { StatusLabel } from "@/components/workspace-settings/StatusLabel";
import { ACTION_COLUMN, CODE_COLUMN, CODE_COLUMN_FOLDED, DELIVERIES_FULL_WIDTH, SHORT_COLUMN, TIME_COLUMN, TOKEN_COLUMN, WIDE_NUMBER_COLUMN } from "@/components/workspace-settings/table-widths";
import { useNarrowContainer } from "@/components/workspace-settings/use-narrow-container";
import { WorkspaceSettingsChrome } from "@/components/workspace-settings/WorkspaceSettingsChrome";
import type { WebhookDeliveryView, WebhookView } from "@/lib/tessera/types";
import { CheckIcon, CopyIcon, RetryIcon, TrashIcon, WebhookIcon } from "@/themes/catppuccin/icons";
import { WebhookDialog } from "./WebhookDialog";
import { DELIVERY_STATUS_LABEL, deliveryStatusVariant, eventSegments, eventsSummary } from "./webhook-format";

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

/** An event name that breaks only after a dot: "work_item." / "updated", never "work_item.update" / "d". */
function EventName({ event }: { event: string }) {
  return (
    <Text type="code">
      {eventSegments(event).map((segment, index) => (
        <Fragment key={index}>
          {index > 0 ? <wbr /> : null}
          {segment}
        </Fragment>
      ))}
    </Text>
  );
}

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
  // Below the full table's floors, seq, attempts, response and next attempt fold under the event so Redeliver stays in view.
  const { ref: bodyRef, isNarrow } = useNarrowContainer(DELIVERIES_FULL_WIDTH);

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

  const eventColumn: TableColumn<DeliveryRow> = { key: "event", header: "Event", width: CODE_COLUMN, renderCell: (row) => <EventName event={row.event} /> };
  const foldedEventColumn: TableColumn<DeliveryRow> = {
    key: "event",
    header: "Event",
    width: CODE_COLUMN_FOLDED,
    renderCell: (row) => (
      <VStack gap={1}>
        <EventName event={row.event} />
        <HStack gap={1} wrap="wrap">
          <Text type="supporting" color="secondary">
            {`#${row.seq} · ${row.attempts} ${row.attempts === 1 ? "attempt" : "attempts"} · ${row.response}`}
          </Text>
          {row.nextAttemptAt ? (
            <>
              <Text type="supporting" color="secondary">
                · next
              </Text>
              <RelativeTime value={row.nextAttemptAt} type="supporting" color="secondary" hasTooltip={false} />
            </>
          ) : null}
        </HStack>
      </VStack>
    ),
  };
  const seqColumn: TableColumn<DeliveryRow> = { key: "seq", header: "Seq", width: SHORT_COLUMN, align: "end", renderCell: (row) => <Text hasTabularNumbers>{row.seq}</Text> };
  const statusColumn: TableColumn<DeliveryRow> = {
    key: "status",
    header: "Status",
    width: TOKEN_COLUMN,
    renderCell: (row) => <StatusLabel variant={deliveryStatusVariant(row.status)} label={DELIVERY_STATUS_LABEL[row.status]} />,
  };
  const attemptsColumn: TableColumn<DeliveryRow> = { key: "attempts", header: "Attempts", width: WIDE_NUMBER_COLUMN, align: "end", renderCell: (row) => <Text hasTabularNumbers>{row.attempts}</Text> };
  const responseColumn: TableColumn<DeliveryRow> = { key: "response", header: "Response", width: WIDE_NUMBER_COLUMN, align: "end", renderCell: (row) => <Text hasTabularNumbers>{row.response}</Text> };
  const nextColumn: TableColumn<DeliveryRow> = {
    key: "next",
    header: "Next attempt",
    width: TIME_COLUMN,
    renderCell: (row) =>
      row.nextAttemptAt ? (
        <RelativeTime value={row.nextAttemptAt} type="supporting" color="secondary" hasTooltip={false} />
      ) : (
        <Text type="supporting" color="secondary">
          —
        </Text>
      ),
  };
  const redeliverColumn: TableColumn<DeliveryRow> = {
    key: "redeliver",
    header: "",
    width: ACTION_COLUMN,
    align: "end",
    renderCell: (row) => (
      <IconButton label="Redeliver" variant="ghost" size="sm" icon={<RetryIcon />} onClick={() => redeliver(row.id)} isDisabled={isPending} />
    ),
  };

  return (
    <WorkspaceSettingsChrome tab="webhooks">
      <VStack gap={6} paddingInline={4} className="tessera-settings-body" ref={bodyRef}>
        <VStack gap={2}>
          {/* The title and the actions share a row and wrap together: below the title on a phone, never past the panel's edge. */}
          <HStack gap={2} vAlign="center" hAlign="between" wrap="wrap" className="tessera-webhook-head">
            <Heading level={3} className="tessera-webhook-title">
              {webhook.name}
            </Heading>
            <HStack gap={2} wrap="wrap" className="tessera-webhook-actions">
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
          {/* The secret field takes the row's free width (an ellipsis only when the secret outgrows it); Copy and Rotate wrap under it on a phone. */}
          <HStack gap={2} vAlign="end" wrap="wrap" className="tessera-webhook-secret">
            <VStack className="tessera-webhook-secret-field">
              <TextInput label="Signing secret" value={secret} isReadOnly />
            </VStack>
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
              columns={isNarrow ? [foldedEventColumn, statusColumn, redeliverColumn] : [eventColumn, seqColumn, statusColumn, attemptsColumn, responseColumn, nextColumn, redeliverColumn]}
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

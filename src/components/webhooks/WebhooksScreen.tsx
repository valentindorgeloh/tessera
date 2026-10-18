"use client";

/**
 * Workspace webhooks list (docs/drafts/p10-plan.md U2): create, edit, deactivate.
 */
import { useState, useTransition } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { List, ListItem } from "@astryxdesign/core/List";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { deleteWebhookAction, updateWebhookAction } from "@/app/actions/webhooks";
import { AlertDialog } from "@/components/shell/dialogs";
import { WorkspaceSettingsChrome } from "@/components/workspace-settings/WorkspaceSettingsChrome";
import type { WebhookView } from "@/lib/tessera/types";
import { PencilIcon, PlusIcon, TrashIcon, WebhookIcon } from "@/themes/catppuccin/icons";
import { WebhookDialog } from "./WebhookDialog";
import { eventsSummary } from "./webhook-format";

export type WebhooksScreenProps = { webhooks: WebhookView[] };

export function WebhooksScreen({ webhooks }: WebhooksScreenProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState<WebhookView | null>(null);
  const [remove, setRemove] = useState<WebhookView | null>(null);

  return (
    <WorkspaceSettingsChrome
      tab="webhooks"
      end={<Button variant="primary" size="sm" label="New webhook" icon={<PlusIcon />} onClick={() => setCreateOpen(true)} />}
    >
      <VStack gap={4} padding={6}>
        {webhooks.length === 0 ? (
          <EmptyState
            icon={<Icon icon={WebhookIcon} size="lg" color="secondary" />}
            title="No webhooks"
            description="Signed POSTs to your URL after workspace activity."
            actions={<Button variant="primary" size="sm" label="New webhook" onClick={() => setCreateOpen(true)} />}
          />
        ) : (
          <List hasDividers density="balanced">
            {webhooks.map((hook) => (
              <WebhookRow key={hook.id} webhook={hook} onEdit={() => setEdit(hook)} onDelete={() => setRemove(hook)} />
            ))}
          </List>
        )}
      </VStack>
      <WebhookDialog isOpen={createOpen} onOpenChange={setCreateOpen} />
      <WebhookDialog isOpen={edit !== null} onOpenChange={(open) => !open && setEdit(null)} webhook={edit} />
      <DeleteWebhookDialog webhook={remove} isOpen={remove !== null} onOpenChange={(open) => !open && setRemove(null)} />
    </WorkspaceSettingsChrome>
  );
}

function WebhookRow({ webhook, onEdit, onDelete }: { webhook: WebhookView; onEdit: () => void; onDelete: () => void }) {
  const toast = useToast();

  const setActive = async (next: boolean) => {
    const result = await updateWebhookAction({ webhook_id: webhook.id, is_active: next });
    if (!result.ok) toast({ type: "error", body: `Could not ${next ? "activate" : "deactivate"} ${webhook.name}. ${result.message}` });
  };

  return (
    <ListItem
      label={webhook.name}
      description={
        <VStack gap={1}>
          <Text type="code" maxLines={1}>
            {webhook.url}
          </Text>
          <Text type="supporting" color="secondary">
            {eventsSummary(webhook.events)}
          </Text>
        </VStack>
      }
      href={`/settings/webhooks/${webhook.id}`}
      endContent={
        <HStack gap={2} vAlign="center">
          {webhook.counts.failed > 0 ? <Badge variant="error" label={`${webhook.counts.failed} failed`} /> : null}
          {webhook.counts.pending > 0 ? <Badge variant="neutral" label={`${webhook.counts.pending} pending`} /> : null}
          <Switch label={`Active ${webhook.name}`} isLabelHidden size="sm" value={webhook.is_active} changeAction={setActive} />
          <MoreMenu
            label={`${webhook.name} actions`}
            size="sm"
            items={[
              { id: "edit", label: "Edit…", icon: PencilIcon, onClick: onEdit },
              { id: "delete", label: "Delete…", icon: TrashIcon, onClick: onDelete },
            ]}
          />
        </HStack>
      }
    />
  );
}

function DeleteWebhookDialog({
  webhook,
  isOpen,
  onOpenChange,
}: {
  webhook: WebhookView | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const toast = useToast();
  const [isDeleting, startDelete] = useTransition();
  const confirm = () => {
    if (webhook === null) return;
    startDelete(async () => {
      const result = await deleteWebhookAction({ webhook_id: webhook.id });
      if (!result.ok) {
        toast({ type: "error", body: `Could not delete ${webhook.name}. ${result.message}` });
        return;
      }
      onOpenChange(false);
      toast({ type: "info", body: `Deleted ${webhook.name}` });
    });
  };
  return (
    <AlertDialog
      isOpen={isOpen}
      onOpenChange={(open) => !isDeleting && onOpenChange(open)}
      title="Delete webhook"
      description={webhook === null ? "" : `${webhook.name} is deleted. Pending deliveries are marked failed.`}
      actionLabel="Delete"
      actionVariant="destructive"
      isActionLoading={isDeleting}
      onAction={confirm}
    />
  );
}

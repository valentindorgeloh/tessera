"use client";

/**
 * Create or edit an outbound webhook (docs/drafts/p10-plan.md U2).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxList, CheckboxListItem } from "@astryxdesign/core/CheckboxList";
import { FieldStatus } from "@astryxdesign/core/FieldStatus";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { createWebhookAction, updateWebhookAction } from "@/app/actions/webhooks";
import { Dialog, DialogHeader } from "@/components/shell/dialogs";
import type { WebhookEvent, WebhookView } from "@/lib/tessera/types";
import {
  COMMON_WEBHOOK_EVENTS,
  customWebhookEvents,
  isCommonWebhookEvent,
  parseCustomEvents,
  webhookNameError,
  webhookUrlError,
} from "./webhook-format";

export type WebhookDialogProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  webhook?: WebhookView | null;
};

export function WebhookDialog({ isOpen, onOpenChange, webhook = null }: WebhookDialogProps) {
  const title = webhook === null ? "New webhook" : `Edit ${webhook.name}`;
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={560} aria-label={title}>
      {isOpen ? <WebhookForm webhook={webhook} title={title} onOpenChange={onOpenChange} /> : null}
    </Dialog>
  );
}

function WebhookForm({ webhook, title, onOpenChange }: { webhook: WebhookView | null; title: string; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(webhook?.name ?? "");
  const [url, setUrl] = useState(webhook?.url ?? "");
  const initialEvents = webhook?.events ?? ["work_item.*"];
  const [checked, setChecked] = useState<string[]>(initialEvents.filter(isCommonWebhookEvent));
  const [custom, setCustom] = useState(customWebhookEvents(initialEvents).join(", "));
  const [formError, setFormError] = useState<string | null>(null);

  const nameError = webhookNameError(name);
  const urlError = webhookUrlError(url);
  const customParsed = parseCustomEvents(custom);
  const events: WebhookEvent[] = [
    ...checked.filter(isCommonWebhookEvent),
    ...customParsed.events.filter((event) => !checked.includes(event)),
  ];
  const eventsError = events.length === 0 ? "Pick at least one event" : customParsed.error;
  const canSave = nameError === null && urlError === null && eventsError === null && !isPending;

  const submit = () => {
    if (!canSave) return;
    setFormError(null);
    startTransition(async () => {
      if (webhook === null) {
        const result = await createWebhookAction({ name: name.trim(), url: url.trim(), events });
        if (!result.ok) {
          setFormError(result.message);
          return;
        }
        toast({ type: "info", body: `Created ${result.data.name}` });
        onOpenChange(false);
        router.push(`/settings/webhooks/${result.data.id}`);
        return;
      }
      const result = await updateWebhookAction({
        webhook_id: webhook.id,
        name: name.trim(),
        url: url.trim(),
        events,
      });
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      toast({ type: "info", body: "Webhook saved" });
      onOpenChange(false);
    });
  };

  return (
    <Layout
      header={<DialogHeader title={title} onOpenChange={() => !isPending && onOpenChange(false)} hasDivider />}
      content={
        <LayoutContent>
          <VStack gap={4} className="tessera-settings-fields">
            <FormLayout>
              <TextInput
                label="Name"
                value={name}
                hasAutoFocus
                isRequired
                onChange={setName}
                onEnter={submit}
                status={nameError !== null && name.trim() !== (webhook?.name ?? "") ? { type: "error", message: nameError } : undefined}
              />
              <TextInput
                label="URL"
                value={url}
                isRequired
                placeholder="https://example.com/hooks/tessera"
                onChange={setUrl}
                onEnter={submit}
                status={urlError !== null && url.trim() !== "" ? { type: "error", message: urlError } : undefined}
              />
              <CheckboxList label="Events" density="compact" value={checked} onChange={setChecked}>
                {COMMON_WEBHOOK_EVENTS.map((entry) => (
                  <CheckboxListItem key={entry.value} value={entry.value} label={entry.label} />
                ))}
              </CheckboxList>
              <TextInput
                label="Custom events"
                description="Comma-separated patterns such as comment.created or ping."
                value={custom}
                onChange={setCustom}
                status={customParsed.error !== null ? { type: "error", message: customParsed.error } : undefined}
              />
            </FormLayout>
            {eventsError !== null && events.length === 0 ? <FieldStatus type="error" message={eventsError} /> : null}
            {formError !== null ? <FieldStatus type="error" message={formError} /> : null}
          </VStack>
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          <HStack gap={3} hAlign="end">
            <Button variant="ghost" label="Cancel" onClick={() => onOpenChange(false)} isDisabled={isPending} />
            <Button variant="primary" label={webhook === null ? "Create" : "Save"} onClick={submit} isLoading={isPending} isDisabled={!canSave} />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}

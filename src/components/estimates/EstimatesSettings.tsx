"use client";

/**
 * Estimates tab of the project settings: the active system, or an empty
 * state that creates one, and the archived systems below it.
 */
import { useState, useTransition } from "react";
import { notFound } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { List, ListItem } from "@astryxdesign/core/List";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Token } from "@astryxdesign/core/Token";
import { useToast } from "@astryxdesign/core/Toast";
import { deleteEstimateAction } from "@/app/actions/estimates";
import { AlertDialog } from "@/components/shell/dialogs";
import { RelativeTime } from "@/components/detail/RelativeTime";
import { failureText } from "@/components/planning/archive-rules";
import { formatEstimateValue } from "@/components/estimates/estimate-format";
import { useOptionalProject } from "@/components/work-items/project-provider";
import type { EstimateType, EstimateView } from "@/lib/tessera/types";
import { HashIcon, TrashIcon } from "@/themes/catppuccin/icons";
import { EstimateDialog } from "./EstimateDialog";

const TYPE_LABEL: Record<EstimateType, string> = { points: "Points", categories: "Categories", time: "Time" };

export function EstimatesSettings({ estimates }: { estimates: EstimateView[] }) {
  const context = useOptionalProject();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  if (!context) notFound();
  const { project } = context.bundle;
  const active = estimates.find((estimate) => estimate.archived_at === null) ?? null;
  const previous = estimates.filter((estimate) => estimate.archived_at !== null);
  const [dialog, setDialog] = useState<"create" | "replace" | "edit" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isArchived = project.archived_at !== null;

  const remove = () => {
    if (!active) return;
    startTransition(async () => {
      const result = await deleteEstimateAction({ estimate_id: active.id });
      setConfirmDelete(false);
      if (!result.ok) toast({ type: "error", body: failureText("Could not delete the estimate system", result.message) });
      else toast({ type: "info", body: "Deleted the estimate system" });
    });
  };

  return (
    <VStack gap={6}>
      {active === null ? (
        <EmptyState
          icon={<Icon icon={HashIcon} size="lg" color="secondary" />}
          title="No estimate system"
          description="Points, categories or time on work items."
          actions={<Button variant="primary" size="sm" label="Create estimate system" onClick={() => setDialog("create")} isDisabled={isArchived} />}
        />
      ) : (
        <VStack gap={3}>
          <HStack gap={2} vAlign="center">
            <Heading level={5}>{active.name}</Heading>
            <Token label={TYPE_LABEL[active.type]} size="sm" />
          </HStack>
          <List density="compact" hasDividers>
            {active.points.map((point) => (
              <ListItem key={point.id} label={formatEstimateValue(active.type, point.value)} description={point.description === "" ? undefined : point.description} />
            ))}
          </List>
          <HStack gap={2}>
            <Button variant="secondary" size="sm" label="Edit values" onClick={() => setDialog("edit")} isDisabled={isArchived} />
            <MoreMenu
              label="Estimate actions"
              size="sm"
              isDisabled={isArchived}
              items={[
                { id: "replace", label: "Replace…", onClick: () => setDialog("replace") },
                { id: "delete", label: "Delete…", icon: TrashIcon, onClick: () => setConfirmDelete(true) },
              ]}
            />
          </HStack>
        </VStack>
      )}
      {previous.length > 0 ? (
        <VStack gap={3}>
          <Heading level={5}>Previous systems</Heading>
          <List density="compact" hasDividers>
            {previous.map((estimate) => (
              <ListItem
                key={estimate.id}
                label={estimate.name}
                description={
                  estimate.archived_at ? (
                    <>
                      Archived <RelativeTime value={estimate.archived_at} hasTooltip={false} />
                    </>
                  ) : (
                    TYPE_LABEL[estimate.type]
                  )
                }
                endContent={<Token label={TYPE_LABEL[estimate.type]} size="sm" />}
              />
            ))}
          </List>
        </VStack>
      ) : null}
      {dialog ? (
        <EstimateDialog
          projectId={project.id}
          isOpen
          onOpenChange={(open) => !open && setDialog(null)}
          mode={dialog}
          estimate={dialog === "create" ? undefined : (active ?? undefined)}
        />
      ) : null}
      {active ? (
        <AlertDialog
          isOpen={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete ${active.name}?`}
          description="Work items that use it lose their estimate."
          actionLabel="Delete"
          actionVariant="destructive"
          isActionLoading={isPending}
          onAction={remove}
        />
      ) : null}
    </VStack>
  );
}

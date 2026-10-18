"use client";

/**
 * Picks the work item an intake item duplicates. Search hits come from
 * `/api/search`; the current item is left out. The engine refuses a target
 * that is still pending in Intake.
 */
import { useEffect, useState, useTransition } from "react";
import { Button } from "@astryxdesign/core/Button";
import { List, ListItem } from "@astryxdesign/core/List";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Dialog, DialogHeader } from "@/components/shell/dialogs";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import type { SearchHit } from "@/lib/tessera/types";

export type DuplicateDialogProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  projectId: string;
  excludeId: string;
  onConfirm: (workItemId: string) => void;
  isPending?: boolean;
};

export function DuplicateDialog({ isOpen, onOpenChange, projectId, excludeId, onConfirm, isPending = false }: DuplicateDialogProps) {
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={480} aria-label="Mark duplicate">
      {isOpen ? (
        <DuplicateForm projectId={projectId} excludeId={excludeId} onOpenChange={onOpenChange} onConfirm={onConfirm} isPending={isPending} />
      ) : null}
    </Dialog>
  );
}

function DuplicateForm({ projectId, excludeId, onOpenChange, onConfirm, isPending }: Omit<DuplicateDialogProps, "isOpen">) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const params = new URLSearchParams({ q: query, types: "work_item", scope: projectId, limit: "20" });
      startTransition(async () => {
        const response = await fetch(`/api/search?${params.toString()}`);
        if (!response.ok) {
          setHits([]);
          return;
        }
        const body = (await response.json()) as { hits?: SearchHit[] };
        setHits((body.hits ?? []).filter((hit) => hit.id !== excludeId));
      });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [excludeId, projectId, query]);

  return (
    <Layout
      header={<DialogHeader title="Mark duplicate" onOpenChange={onOpenChange} hasDivider />}
      content={
        <LayoutContent>
          <VStack gap={3}>
            <TextInput label="Search work items" value={query} onChange={setQuery} hasClear placeholder="Name or key" />
            {hits.length === 0 ? (
              <Text type="supporting" color="secondary">
                {query === "" ? "Type to search." : "No matching work items."}
              </Text>
            ) : (
              <List hasDividers density="compact" aria-label="Matching work items">
                {hits.map((hit) => (
                  <ListItem
                    key={hit.id}
                    label={hit.title}
                    description={hit.key ?? undefined}
                    isSelected={picked === hit.id}
                    onClick={() => setPicked(hit.id)}
                  />
                ))}
              </List>
            )}
          </VStack>
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          <HStack gap={3} hAlign="end">
            <Button variant="ghost" label="Cancel" onClick={() => onOpenChange(false)} />
            <Button variant="primary" label="Mark duplicate" isDisabled={picked === null} isLoading={isPending} onClick={() => picked && onConfirm(picked)} />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}

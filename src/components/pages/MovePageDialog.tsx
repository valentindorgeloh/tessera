"use client";

/**
 * Moves a page to another space or parent (docs/drafts/p6-plan.md
 * "MovePageDialog"). The parent list loads when the space changes, through
 * the list_pages action, and leaves out the page and its subtree.
 *
 * ASSUMPTION: the plan's screen props do not include the project list. The
 * routes pass the active projects that have Pages on (`pageSpaces`).
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { Selector, type SelectorOptionData } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { listPagesAction, movePageAction } from "@/app/actions/pages";
import { Dialog, DialogHeader } from "@/components/shell/dialogs";
import type { PageSummary } from "@/lib/tessera/types";
import { pageHref, subtreeIds, type PageSpaceOption } from "./page-tree";

export type MovePageDialogProps = {
  page: PageSummary;
  spaces: readonly PageSpaceOption[];
  /** Shown when the page's project is not in `spaces` (an archived project). */
  spaceName?: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

const TOP = "top";

export function MovePageDialog({ isOpen, onOpenChange, ...props }: MovePageDialogProps) {
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={480} aria-label="Move page">
      {isOpen ? <MoveForm onOpenChange={onOpenChange} {...props} /> : null}
    </Dialog>
  );
}

function MoveForm({ page, spaces, spaceName, onOpenChange }: Omit<MovePageDialogProps, "isOpen">) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startMove] = useTransition();
  const [space, setSpace] = useState(page.project_id ?? "wiki");
  const [parent, setParent] = useState(page.parent_id ?? TOP);
  const [candidates, setCandidates] = useState<PageSummary[]>([]);
  const [isLoading, setLoading] = useState(true);
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  });

  useEffect(() => {
    let cancelled = false;
    void listPagesAction({ project_id: space === "wiki" ? null : space }).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        toastRef.current({ type: "error", body: `Could not load pages. ${result.message}` });
        setCandidates([]);
        return;
      }
      setCandidates(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [space]);

  const hidden = subtreeIds(candidates, page.id);
  const parentOptions: SelectorOptionData[] = [
    { value: TOP, label: "Top level" },
    ...candidates.filter((candidate) => !hidden.has(candidate.id)).map((candidate) => ({ value: candidate.id, label: candidate.name })),
  ];
  const parentValue = parentOptions.some((option) => option.value === parent) ? parent : TOP;
  const knownSpaces = page.project_id !== null && !spaces.some((option) => option.id === page.project_id);
  const spaceOptions: SelectorOptionData[] = [
    { value: "wiki", label: "Wiki" },
    ...(knownSpaces && page.project_id !== null ? [{ value: page.project_id, label: spaceName ?? "This project" }] : []),
    ...spaces.map((option) => ({ value: option.id, label: option.name })),
  ];
  const leavesProject = page.project_id !== null && space !== page.project_id;

  const changeSpace = (value: string) => {
    setSpace(value);
    setParent(TOP);
    setLoading(true);
  };

  const submit = () => {
    const projectId = space === "wiki" ? null : space;
    const parentId = parentValue === TOP ? null : parentValue;
    if (projectId === page.project_id && parentId === page.parent_id) {
      onOpenChange(false);
      return;
    }
    startMove(async () => {
      const result = await movePageAction({ page_id: page.id, project_id: projectId, parent_id: parentId });
      if (!result.ok) {
        toast({ type: "error", body: `Could not move ${page.name}. ${result.message}` });
        return;
      }
      onOpenChange(false);
      toast({ type: "info", body: `Moved ${page.name}` });
      const next = pageHref(result.data);
      if (next !== pageHref(page)) router.push(next);
    });
  };

  return (
    <Layout
      header={<DialogHeader title="Move page" onOpenChange={() => !isPending && onOpenChange(false)} hasDivider />}
      content={
        <LayoutContent>
          <VStack gap={4}>
            <Selector label="Space" options={spaceOptions} value={space} onChange={changeSpace} />
            <Selector label="Parent" hasSearch options={parentOptions} value={parentValue} onChange={setParent} isDisabled={isLoading} />
            {leavesProject ? (
              <Text type="supporting" color="secondary">
                Labels are removed when a page leaves its project.
              </Text>
            ) : null}
          </VStack>
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          <HStack gap={2} hAlign="end">
            <Button variant="secondary" label="Cancel" onClick={() => onOpenChange(false)} isDisabled={isPending} />
            <Button variant="primary" label="Move" onClick={submit} isLoading={isPending || isLoading} />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}

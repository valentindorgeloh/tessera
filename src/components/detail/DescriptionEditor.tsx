"use client";

/**
 * Description of a work item (docs/contracts/ui.md "DescriptionEditor"):
 * composes the Markdown editor with the save queue and the Banner states of
 * docs/contracts/editor.md ("Changed elsewhere", "Updated elsewhere", lossy
 * parse). Entity links to work items resolve their key through
 * `GET /api/search` and open through `onOpenItem`; cycle and module links open
 * their alias route (`entityRoute`), which redirects into the project; page
 * links arrive with P6.
 */
import { useRef } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { useProject } from "@/components/work-items/project-provider";
import { MarkdownEditor, entityRoute, useDescriptionSave, type EntityLink, type MarkdownEditorHandle } from "@/components/editor";
import { matchWorkItemRef, toCandidates } from "./search-hits";

export type DescriptionEditorProps = {
  workItemId: string;
  /** Markdown the host currently holds (server value after every refresh). */
  text: string;
  /** description_version of `text`. */
  version: number;
  readOnly?: boolean;
  /** Peek: tighter editor. */
  compact?: boolean;
  onOpenItem: (id: string) => void;
};

const STATUS_TEXT = {
  clean: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving…",
  conflict: "Not saved",
  error: "Not saved",
} as const;

/** Id of the work item a `work:<KEY>` link names, or null: a key match ranks first (search.ts keyHit), and a title-only hit is not taken for it. */
async function resolveWorkItemId(ref: string): Promise<string | null> {
  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(ref)}&types=work_item&limit=1`);
    if (!response.ok) return null;
    return matchWorkItemRef(toCandidates(await response.json()), ref)?.id ?? null;
  } catch {
    return null;
  }
}

export function DescriptionEditor({ workItemId, text, version, readOnly = false, compact = false, onOpenItem }: DescriptionEditorProps) {
  const toast = useToast();
  const router = useRouter();
  const { bundle } = useProject();
  const editor = useRef<MarkdownEditorHandle | null>(null);
  const save = useDescriptionSave({ workItemId, serverText: text, serverVersion: version, editor });
  const { state } = save;
  // The editor reports a lossy parse once after mount; the hook holds it until "Edit anyway" or "View source".
  const lossy = state.lossy;

  // A failed save is toasted by useDescriptionSave itself; the status line below says "Not saved".
  const mentionActors = bundle.actors.filter((actor) => actor.deleted_at === null).map((actor) => ({ id: actor.id, name: actor.name }));

  const openEntity = (link: EntityLink) => {
    if (link.scheme === "work") {
      void resolveWorkItemId(link.ref).then((id) => {
        if (id) onOpenItem(id);
        else toast({ type: "error", body: `No work item named ${link.ref}` });
      });
      return;
    }
    const route = entityRoute(link);
    if (route !== null) router.push(route);
    else if (link.scheme === "page") router.push(`/pages/${encodeURIComponent(link.ref)}`);
    else toast({ type: "info", body: "This link has no route yet" });
  };

  let banner = null;
  if (state.status === "conflict" || state.theirs !== null) {
    banner = (
      <Banner
        status="warning"
        title={state.status === "conflict" ? "Changed elsewhere" : "Updated elsewhere"}
        description="Someone else saved this description while you were editing."
        endContent={
          <HStack gap={1}>
            <Button variant="secondary" size="sm" label="Keep mine" onClick={() => void save.keepMine()} />
            <Button variant="ghost" size="sm" label="Load theirs" onClick={save.loadTheirs} />
          </HStack>
        }
      />
    );
  } else if (lossy !== null) {
    banner = (
      <Banner
        status="info"
        title="This description uses Markdown the editor would rewrite"
        description="Editing it here would change its formatting."
        endContent={
          <HStack gap={1}>
            <Button variant="secondary" size="sm" label="View source" onClick={save.viewSource} />
            <Button variant="ghost" size="sm" label="Edit anyway" onClick={save.editAnyway} />
          </HStack>
        }
      />
    );
  }

  return (
    <VStack gap={2} className="tessera-detail-description">
      <Text type="label" color="secondary">
        Description
      </Text>
      {banner}
      <MarkdownEditor
        key={workItemId}
        ref={editor}
        value={text}
        onChange={save.onChange}
        onFlush={() => void save.flush()}
        onLossyParse={save.onLossyParse}
        readOnly={readOnly || lossy !== null}
        compact={compact}
        placeholder="Add context, links or acceptance criteria"
        mentionActors={mentionActors}
        projectId={bundle.project.id}
        onOpenEntity={openEntity}
      />
      <Text type="supporting" color="secondary" aria-live="polite">
        {readOnly ? "Read only" : STATUS_TEXT[state.status]}
      </Text>
    </VStack>
  );
}

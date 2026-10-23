"use client";

/**
 * The saved view page's end slot in the filters row (docs/drafts/p4-ui.md
 * "ViewBar", decision 32). The view's own state is the row; every change made
 * on the page lives in the URL's `q` until "Update view". Modified: a dot and
 * "Modified" with Reset (drop `q`), Save as new view (create from the
 * effective state) and Update view (replace the saved filters and display,
 * then drop `q`). A locked view keeps Reset and Save as new view; Update view
 * is disabled with its reason. In an archived project only Reset shows. It
 * also registers the view's name for the recents label.
 */
import { startTransition, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { updateViewAction } from "@/app/actions/views";
import { withSearchParam } from "@/components/detail/peek-url";
import { registerEntityLabel } from "@/components/shell/entity-labels";
import { useProject } from "@/components/work-items/project-provider";
import type { View } from "@/lib/tessera/types";
import { ResetIcon, SaveIcon } from "@/themes/catppuccin/icons";
import { ViewDialog } from "./ViewDialog";
import { normalizeFilters, type ViewState } from "./view-state";

export type ViewBarProps = {
  /** Null saves a new workspace view. */
  projectId: string | null;
  view: View;
  /** Whether the effective state differs from the saved one (computed on the server). */
  isModified: boolean;
  /** Saved view merged with the URL's `q`. */
  effective: ViewState;
};

export function ViewBar({ projectId, view, isModified, effective }: ViewBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();
  const { bundle } = useProject();
  const [isSaveAsOpen, setSaveAsOpen] = useState(false);
  const [isUpdating, setUpdating] = useState(false);
  const isArchived = bundle.project.archived_at !== null;

  useEffect(() => {
    registerEntityLabel(view.id, view.name);
  }, [view.id, view.name]);

  if (!isModified) return null;

  // Only `q` goes; an open `peek` stays.
  const withoutQuery = () => withSearchParam(pathname, searchParams, "q", null);
  const reset = () => router.replace(withoutQuery(), { scroll: false });

  const update = () => {
    setUpdating(true);
    startTransition(async () => {
      const result = await updateViewAction({
        view_id: view.id,
        filters: normalizeFilters(effective.filters),
        display: effective.display,
        rich_filters: effective.rich_filters ?? null,
      });
      setUpdating(false);
      if (!result.ok) {
        toast({ type: "error", body: `Could not update ${view.name}: ${result.message}` });
        return;
      }
      router.replace(withoutQuery(), { scroll: false });
    });
  };

  return (
    <>
      <HStack gap={2} vAlign="center" wrap="wrap" className="tessera-view-bar">
        <StatusDot variant="accent" label="Unsaved changes" tooltip="Filters or display differ from the saved view" />
        <Text type="supporting" color="secondary">
          Modified
        </Text>
        <Button variant="ghost" size="sm" label="Reset" icon={<ResetIcon />} onClick={reset} />
        {isArchived ? null : (
          <>
            <Button variant="secondary" size="sm" label="Save as new view" onClick={() => setSaveAsOpen(true)} />
            <Button
              variant="primary"
              size="sm"
              label="Update view"
              icon={<SaveIcon />}
              onClick={update}
              isLoading={isUpdating}
              isDisabled={view.is_locked}
              tooltip={view.is_locked ? "Unlock the view to update it" : undefined}
            />
            {/* A disabled button cannot be tapped to show its tooltip: where nothing hovers the reason is written out (views.css). */}
            {view.is_locked ? (
              <Text type="supporting" color="secondary" className="tessera-view-bar-reason">
                Unlock the view to update it
              </Text>
            ) : null}
          </>
        )}
      </HStack>
      <ViewDialog isOpen={isSaveAsOpen} onOpenChange={setSaveAsOpen} projectId={projectId} mode="create" title="Save as new view" initial={effective} />
    </>
  );
}

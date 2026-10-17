"use client";

/**
 * "Save view" in the project list's filters row (docs/drafts/p4-ui.md): shown
 * while filters or display are set in the URL; opens the view dialog with the
 * current filters and display.
 */
import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import type { Display, Filters } from "@/lib/tessera/types";
import { SaveIcon } from "@/themes/catppuccin/icons";
import { ViewDialog } from "./ViewDialog";
import { normalizeFilters } from "./view-state";

export type SaveViewButtonProps = { projectId: string; filters: Filters; display: Display };

export function SaveViewButton({ projectId, filters, display }: SaveViewButtonProps) {
  const [isOpen, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" label="Save view" icon={<SaveIcon />} onClick={() => setOpen(true)} />
      <ViewDialog
        isOpen={isOpen}
        onOpenChange={setOpen}
        projectId={projectId}
        mode="create"
        title="Save view"
        initial={{ filters: normalizeFilters(filters), display }}
      />
    </>
  );
}

"use client";

/**
 * Module detail (docs/contracts/ui.md "Modules (E2)"): the cycle detail's
 * layout with `ModuleHeader` and `ModuleSidePanel`. The module's work items
 * arrive as `children` (E4's `ScopedWorkItems`, a Server Component passed into
 * this Client Component, with its own panel header and scroller) and fill the
 * content slot; the side panel sits in the
 * `end` slot while it is open (`panel-prefs`, shared with cycles) and steps
 * aside while the peek shows an item, whose own panel takes that place (the
 * header's toggle is disabled meanwhile).
 *
 * `useModuleWriter` is the one writer for the inline controls of the header
 * and the panel: the module renders through `useOptimistic`, so a picked
 * value stays visible while the action and the refresh run, values equal to
 * the latest one written are dropped (selectors and date inputs re-fire), and
 * a failure shows an error Toast with the engine's message.
 */
import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useOptimistic, useRef, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { useToast } from "@astryxdesign/core/Toast";
import { setModuleMembersAction, updateModuleAction } from "@/app/actions/modules";
import { peekIdOf } from "@/components/detail/peek-url";
import { registerEntityLabel } from "@/components/shell/entity-labels";
import { useProject } from "@/components/work-items/project-provider";
import type { ModuleDetail } from "@/lib/tessera/types";
import { ModuleHeader } from "./ModuleHeader";
import { ModuleSidePanel } from "./ModuleSidePanel";
import { sameMembers, type ModuleFormValues } from "./module-format";
import { savePanelPrefs, usePanelPrefs } from "./panel-prefs";
import type { ModuleDetailData } from "./types";

export type ModuleDetailScreenProps = { projectId: string; data: ModuleDetailData; children: ReactNode };

/** Inline fields of the header and the panel; the name and description change through the edit dialog. */
export type ModuleInlinePatch = Partial<Pick<ModuleFormValues, "status" | "lead_actor_id" | "start_date" | "target_date">>;

export type ModuleWriter = {
  update: (patch: ModuleInlinePatch) => void;
  setMembers: (actorIds: string[]) => void;
};

type OptimisticPatch = ModuleInlinePatch & { member_ids?: string[] };

type Outcome = { ok: true } | { ok: false; message: string };

function applyPatch(module: ModuleDetail, patch: OptimisticPatch): ModuleDetail {
  return { ...module, ...patch };
}

/** The fields of `patch` that differ from `current`; null when nothing changes. */
function changedInline(current: ModuleDetail, patch: ModuleInlinePatch): ModuleInlinePatch | null {
  const changed: ModuleInlinePatch = {};
  if (patch.status !== undefined && patch.status !== current.status) changed.status = patch.status;
  if (patch.lead_actor_id !== undefined && patch.lead_actor_id !== current.lead_actor_id) changed.lead_actor_id = patch.lead_actor_id;
  if (patch.start_date !== undefined && patch.start_date !== current.start_date) changed.start_date = patch.start_date;
  if (patch.target_date !== undefined && patch.target_date !== current.target_date) changed.target_date = patch.target_date;
  return Object.keys(changed).length > 0 ? changed : null;
}

export function useModuleWriter(module: ModuleDetail): { view: ModuleDetail; writer: ModuleWriter } {
  const toast = useToast();
  const [view, addOptimistic] = useOptimistic(module, applyPatch);

  // The values the last write asked for; reset to the rendered view after every commit (success or rollback).
  const latest = useRef(view);
  useLayoutEffect(() => {
    latest.current = view;
  }, [view]);

  const moduleId = module.id;
  const write = useCallback(
    (patch: OptimisticPatch, call: () => Promise<Outcome>) => {
      latest.current = applyPatch(latest.current, patch);
      startTransition(async () => {
        addOptimistic(patch);
        const result = await call();
        if (!result.ok) toast({ type: "error", body: `Could not save the module: ${result.message}` });
      });
    },
    [addOptimistic, toast],
  );

  const writer = useMemo<ModuleWriter>(
    () => ({
      update: (patch) => {
        const changed = changedInline(latest.current, patch);
        if (changed === null) return;
        write(changed, () => updateModuleAction({ module_id: moduleId, ...changed }));
      },
      setMembers: (actorIds) => {
        if (sameMembers(latest.current.member_ids, actorIds)) return;
        write({ member_ids: actorIds }, () => setModuleMembersAction({ module_id: moduleId, actor_ids: actorIds }));
      },
    }),
    [moduleId, write],
  );
  return { view, writer };
}

export function ModuleDetailScreen({ projectId, data, children }: ModuleDetailScreenProps) {
  const searchParams = useSearchParams();
  const peekOpen = peekIdOf(searchParams) !== null;
  const prefs = usePanelPrefs();
  const { view, writer } = useModuleWriter(data.module);
  // An archived project is read-only (F3.4): the header and the side panel get `readOnly` from the project, so their
  // controls render read-only and never reach the engine; no candidates are offered.
  const { bundle } = useProject();
  const isReadOnly = bundle.project.archived_at !== null;

  const { id, name } = data.module;
  useEffect(() => {
    registerEntityLabel(id, name);
  }, [id, name]);

  return (
    <Layout
      height="fill"
      header={
        <ModuleHeader
          projectId={projectId}
          module={view}
          writer={writer}
          readOnly={isReadOnly}
          candidates={isReadOnly ? [] : data.candidates}
          isPanelOpen={prefs.open && !peekOpen}
          isPanelBlocked={peekOpen}
          onTogglePanel={() => savePanelPrefs({ open: !prefs.open })}
        />
      }
      content={
        // Named after the module: the list inside brings its own "Work items" panel header.
        <LayoutContent padding={0} isScrollable label={`${view.name} work items`}>
          {children}
        </LayoutContent>
      }
      end={prefs.open && !peekOpen ? <ModuleSidePanel module={view} writer={writer} readOnly={isReadOnly} /> : undefined}
    />
  );
}

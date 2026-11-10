"use client";

/**
 * The read-only values of a table cell (labels, modules, assignees), drawn as the quiet resting look of the work items
 * screen: borderless tinted pills and avatars with names, no control box and no chevron. The table never edits these
 * (`LayoutProps.onUpdate` carries no set-style fields for them), so a cell holds the value alone instead of a disabled
 * multi-selector: no layer sentinel per cell, and nothing that could look like a control.
 */
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { ActorAvatar } from "@/components/shell/ActorAvatar";
import { useProjectRow } from "../project-provider";
import { archivedModulesLabel, splitModuleValue, splitShownNames } from "./membership-rules";
import { paletteTokenColor } from "./option-helpers";

/** Two label pills in the label's own colour, then "+N" (the list row's rule, docs/drafts/plane-visual-reference.md section 6). */
export function LabelTokens({ ids }: { ids: readonly string[] }) {
  const { labelsById } = useProjectRow();
  const labels = ids.flatMap((id) => {
    const label = labelsById.get(id);
    return label ? [label] : [];
  });
  if (labels.length === 0) return null;
  const { shown, hidden } = splitShownNames(labels);
  return (
    <HStack gap={1} vAlign="center" className="tessera-wi-cell-tokens">
      {shown.map((label) => (
        <Token key={label.id} label={label.name} size="sm" color={paletteTokenColor(label.color)} />
      ))}
      {hidden > 0 ? <Token label={`+${hidden}`} size="sm" description={`${hidden} more labels`} /> : null}
    </HStack>
  );
}

/** The module names as pills; archived modules (not in the bundle) fold into one "N archived modules" pill, as the control shows them. */
export function ModuleTokens({ ids }: { ids: readonly string[] }) {
  const { bundle, modulesById } = useProjectRow();
  const { editable, kept } = splitModuleValue(ids, bundle.modules);
  const modules = editable.flatMap((id) => {
    const found = modulesById.get(id);
    return found ? [found] : [];
  });
  if (modules.length === 0 && kept.length === 0) return null;
  const { shown, hidden } = splitShownNames(modules);
  return (
    <HStack gap={1} vAlign="center" className="tessera-wi-cell-tokens">
      {shown.map((entry) => (
        <Token key={entry.id} label={entry.name} size="sm" />
      ))}
      {hidden > 0 ? <Token label={`+${hidden}`} size="sm" description={`${hidden} more modules`} /> : null}
      {kept.length > 0 ? <Token size="sm" color="gray" label={archivedModulesLabel(kept.length)} /> : null}
    </HStack>
  );
}

/** Avatars (the first three) and the names in one line; an empty value draws nothing. */
export function AssigneeValue({ ids }: { ids: readonly string[] }) {
  const { actorsById } = useProjectRow();
  const actors = ids.flatMap((id) => {
    const actor = actorsById.get(id);
    return actor ? [actor] : [];
  });
  if (actors.length === 0) return null;
  return (
    <HStack gap={1.5} vAlign="center" className="tessera-wi-cell-assignees">
      <HStack gap={0.5} vAlign="center">
        {actors.slice(0, 3).map((actor) => (
          <ActorAvatar key={actor.id} actor={actor} size="xsm" tooltip={false} />
        ))}
      </HStack>
      <Text type="inherit" className="tessera-wi-label-text">
        {actors.map((actor) => actor.name).join(", ")}
      </Text>
    </HStack>
  );
}

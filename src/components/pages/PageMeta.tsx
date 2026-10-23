"use client";

/**
 * Access, lock, labels and the last edit (docs/drafts/p6-plan.md "PageMeta").
 * The access token and shift+a (handled by the screen) toggle public and
 * private. Labels exist only on a project page.
 */
import { useState } from "react";
import { MultiSelector, type MultiSelectorOptionData } from "@astryxdesign/core/MultiSelector";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { Icon } from "@astryxdesign/core/Icon";
import { RelativeTime } from "@/components/detail/RelativeTime";
import { paletteTokenColor } from "@/components/work-items/properties";
import type { ActorRow, Label, PageDetail } from "@/lib/tessera/types";
import { EyeSlashIcon, GlobeIcon, LockIcon } from "@/themes/catppuccin/icons";

export type PageMetaProps = {
  page: PageDetail;
  labels: Label[] | null;
  actors: readonly ActorRow[];
  /** Locked, archived, or the project is archived: labels cannot change. */
  labelsReadOnly: boolean;
  /** Archived, or the project is archived: access stays as it is. */
  accessReadOnly: boolean;
  onToggleAccess: () => void;
  /** Resolves false when the write failed, so the selector returns to the saved labels. */
  onLabels: (labelIds: string[]) => Promise<boolean>;
};

export function PageMeta({ page, labels, actors, labelsReadOnly, accessReadOnly, onToggleAccess, onLabels }: PageMetaProps) {
  const labelKey = page.label_ids.join("\0");
  const [seenLabels, setSeenLabels] = useState(labelKey);
  const [pendingLabels, setPendingLabels] = useState<string[] | null>(null);
  if (seenLabels !== labelKey) {
    setSeenLabels(labelKey);
    setPendingLabels(null);
  }
  const actor = actors.find((row) => row.id === page.updated_by);
  const labelValue = pendingLabels ?? page.label_ids;
  const options: MultiSelectorOptionData[] = (labels ?? []).map((row) => ({ value: row.id, label: row.name }));
  const byId = new Map((labels ?? []).map((row) => [row.id, row]));

  const changeLabels = (next: string[]) => {
    setPendingLabels(next);
    void onLabels(next).then((ok) => {
      if (!ok) setPendingLabels(null);
    });
  };

  return (
    <HStack gap={2} vAlign="center" wrap="wrap" className="tessera-page-meta">
      <Token
        label={page.access === "public" ? "Public" : "Private"}
        size="sm"
        icon={<Icon icon={page.access === "public" ? GlobeIcon : EyeSlashIcon} />}
        onClick={accessReadOnly ? undefined : onToggleAccess}
        className="tessera-page-meta-control"
      />
      {page.is_locked ? <Token label="Locked" size="sm" icon={<Icon icon={LockIcon} />} /> : null}
      {labels === null ? null : (
        <MultiSelector
          label="Labels"
          isLabelHidden
          size="sm"
          options={options}
          value={labelValue}
          onChange={changeLabels}
          isReadOnly={labelsReadOnly}
          hasSearch={options.length > 8}
          placeholder="Labels"
          className="tessera-page-meta-control"
          emptyText="No labels in this project yet"
          renderOption={(option) => <Token label={option.label ?? option.value} size="sm" color={paletteTokenColor(byId.get(option.value)?.color)} />}
        />
      )}
      <HStack gap={1} vAlign="center">
        <Text type="supporting" color="secondary">
          Edited
        </Text>
        <RelativeTime value={page.updated_at} type="supporting" color="secondary" hasTooltip={false} />
        <Text type="supporting" color="secondary">
          by {actor?.name ?? "Someone"}
        </Text>
      </HStack>
    </HStack>
  );
}

"use client";

import { useEffect, useState, useTransition } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Spinner } from "@astryxdesign/core/Spinner";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { listActorsAction, restorePageVersionAction, restoreWorkItemVersionAction } from "@/app/actions/history";
import { AlertDialog, Dialog, DialogHeader } from "@/components/shell/dialogs";
import type { HistoryResponse, VersionInfo } from "@/lib/tessera/types";
import { diffLines } from "./diff-lines";

export type VersionHistoryDialogProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  entity: { type: "work_item" | "page"; id: string; title: string; descriptionVersion: number; currentText: string; readOnly?: boolean };
};

type Mode = "changes" | "current" | "full";

/** Shown when an actor id has no row (a removed agent) or the actors list could not load. */
const UNKNOWN_ACTOR = "Unknown";

function previousText(versions: VersionInfo[], selected: VersionInfo): string {
  const older = versions.filter((row) => row.created_at < selected.created_at || (row.created_at === selected.created_at && row.version < selected.version));
  return older[0]?.description_md ?? "";
}

export function VersionHistoryDialog({ isOpen, onOpenChange, entity }: VersionHistoryDialogProps) {
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actorNames, setActorNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("changes");
  const [confirm, setConfirm] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void fetch(`/api/history/${entity.type}/${entity.id}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load version history");
        return (await response.json()) as HistoryResponse;
      })
      .then((data) => {
        if (cancelled) return;
        setHistory(data);
        setSelectedId(data.versions[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load version history");
      });
    // Actor names are a nicety: a failed list leaves "Unknown" instead of blocking the history.
    void listActorsAction({}).then((result) => {
      if (cancelled || !result.ok) return;
      setActorNames(new Map(result.data.items.map((actor) => [actor.id, actor.name])));
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, entity.id, entity.type]);

  const selected = history?.versions.find((row) => row.id === selectedId) ?? null;
  const currentText = history?.description_md ?? entity.currentText;
  const descriptionVersion = history?.description_version ?? entity.descriptionVersion;
  const before = selected && history ? (mode === "current" ? currentText : mode === "full" ? "" : previousText(history.versions, selected)) : "";
  const after = mode === "full" ? (selected?.description_md ?? "") : (selected?.description_md ?? "");
  const lines = selected ? (mode === "full" ? [{ kind: "same" as const, text: after }] : diffLines(before, after)) : [];

  const restore = () => {
    if (!selected) return;
    startTransition(async () => {
      const result =
        entity.type === "page"
          ? await restorePageVersionAction({
              page_id: entity.id,
              version_id: selected.id,
              expected_description_version: descriptionVersion,
            })
          : await restoreWorkItemVersionAction({
              work_item_id: entity.id,
              version_id: selected.id,
              expected_description_version: descriptionVersion,
            });
      setConfirm(false);
      if (!result.ok) {
        if (result.code === "CONFLICT") setConflict(true);
        else setError(result.message);
        return;
      }
      onOpenChange(false);
    });
  };

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="info" width={960} maxHeight="85vh" aria-label="Version history">
      <Layout
        header={<DialogHeader title={`Version history · ${entity.title}`} onOpenChange={onOpenChange} hasDivider />}
        content={
          <LayoutContent>
            {error ? <Banner status="warning" title="Could not load history" description={error} /> : null}
            {conflict ? (
              <Banner
                status="warning"
                title="This text changed since you opened the history"
                description={entity.type === "page" ? "Reload the page and open history again." : "Reload the work item and open history again."}
              />
            ) : null}
            {history === null && error === null ? <Spinner label="Loading versions" /> : null}
            {history && history.versions.length === 0 ? <Text>No versions yet. They are kept when the description changes.</Text> : null}
            {history && selected ? (
              <HStack gap={4} vAlign="stretch">
                <VStack gap={2} className="tessera-history-pane">
                  {history.versions.map((row) => (
                    <VStack key={row.id} gap={0}>
                      <Button variant={row.id === selectedId ? "secondary" : "ghost"} size="sm" label={`Version ${row.version}`} onClick={() => setSelectedId(row.id)} />
                      <Text type="supporting" color="secondary">
                        {actorNames.size === 0 ? " " : (actorNames.get(row.actor_id) ?? UNKNOWN_ACTOR)}
                      </Text>
                    </VStack>
                  ))}
                  {selected ? <Timestamp value={selected.created_at} /> : null}
                </VStack>
                <VStack gap={3} className="tessera-history-pane">
                  <SegmentedControl label="Diff" size="sm" value={mode} onChange={(value) => setMode(value === "current" || value === "full" ? value : "changes")}>
                    <SegmentedControlItem value="changes" label="Changes" />
                    <SegmentedControlItem value="current" label="Compare with current" />
                    <SegmentedControlItem value="full" label="Full text" />
                  </SegmentedControl>
                  <VStack gap={0}>
                    {lines.map((line, index) => (
                      <Text key={index} type="code" className="tessera-diff-line" data-change={line.kind === "same" ? undefined : line.kind}>
                        {line.words
                          ? line.words.map((word, wordIndex) => (
                              <Text key={wordIndex} type="code" className="tessera-diff-word" data-change={word.kind === "same" ? undefined : word.kind}>
                                {word.text}
                              </Text>
                            ))
                          : line.text || " "}
                      </Text>
                    ))}
                  </VStack>
                  {entity.readOnly ? null : (
                    <Button variant="primary" size="sm" label="Restore this version" onClick={() => setConfirm(true)} isLoading={isPending} />
                  )}
                </VStack>
              </HStack>
            ) : null}
            <AlertDialog
              isOpen={confirm}
              onOpenChange={setConfirm}
              title="Restore this version?"
              description={entity.type === "page" ? "The name and body are replaced." : "The description is replaced. The name stays as it is."}
              actionLabel="Restore"
              onAction={restore}
            />
          </LayoutContent>
        }
      />
    </Dialog>
  );
}

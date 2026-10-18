"use client";

/**
 * Intake for one project: Open, Snoozed and Closed beside the selected work
 * item. Tabs and the selected item are links. Search waits 300ms, then
 * writes `q`.
 */
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { Layout, LayoutContent, LayoutPanel } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { HStack } from "@astryxdesign/core/Stack";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Token } from "@astryxdesign/core/Token";
import { useAssistant } from "@/components/ai/AssistantProvider";
import { RelativeTime } from "@/components/detail/RelativeTime";
import { PanelBar } from "@/components/shell/PanelHeader";
import { CreateWorkItemDialog } from "@/components/work-items/CreateWorkItemDialog";
import { priorityOption } from "@/components/work-items/properties";
import type { IntakeCounts, IntakeItemView, IntakeTab } from "@/lib/tessera/types";
import { PlusIcon, SparkleIcon } from "@/themes/catppuccin/icons";
import { intakeHref, INTAKE_TABS, sourceLabel, statusToken, type IntakeQuery } from "./intake-format";

const TAB_LABEL: Record<IntakeTab, string> = { open: "Open", snoozed: "Snoozed", closed: "Closed" };
const EMPTY: Record<IntakeTab, string> = { open: "Nothing waiting", snoozed: "Nothing snoozed", closed: "Nothing closed yet" };
const TRIAGE_PROMPT = "Triage the open intake items: for each, propose accept, decline or mark as duplicate, with a one-line reason.";

export type IntakeScreenProps = {
  projectId: string;
  query: IntakeQuery;
  items: readonly IntakeItemView[];
  counts: IntakeCounts;
  children?: ReactNode;
};

export function IntakeScreen({ projectId, query, items, counts, children }: IntakeScreenProps) {
  const router = useRouter();
  const assistant = useAssistant();
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState(query.q);
  const [syncedQuery, setSyncedQuery] = useState(query.q);
  if (query.q !== syncedQuery) {
    setSyncedQuery(query.q);
    setSearch(query.q);
  }
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (search === query.q) return;
    const handle = window.setTimeout(() => {
      startTransition(() => {
        router.push(intakeHref(projectId, query.tab, search.trim(), query.item));
      });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [projectId, query.item, query.q, query.tab, router, search]);

  const href = (tab: IntakeTab) => intakeHref(projectId, tab, query.q, query.item);

  return (
    <>
      <Layout
        height="fill"
        className="tessera-intake"
        start={
          <LayoutPanel width={360} hasDivider padding={0} isScrollable label="Intake items" className="tessera-intake-list">
            <PanelBar
              canWrap
              start={
                <TabList value={query.tab} onChange={() => {}} size="sm" layout="hug" aria-label="Intake">
                  {INTAKE_TABS.map((tab) => (
                    <Tab key={tab} value={tab} label={TAB_LABEL[tab]} href={href(tab)} endContent={<Badge label={String(counts[tab])} />} />
                  ))}
                </TabList>
              }
            />
            <PanelBar
              size="filters"
              start={<TextInput label="Search intake" isLabelHidden hasClear value={search} onChange={setSearch} placeholder="Search intake" className="tessera-intake-search" />}
              end={
                <HStack gap={1}>
                  <Button variant="secondary" size="sm" label="New intake item" icon={<PlusIcon />} onClick={() => setCreateOpen(true)} />
                  {assistant.status?.available === true ? (
                    <Button variant="ghost" size="sm" label="Triage with assistant" icon={<SparkleIcon />} onClick={() => assistant.ask(TRIAGE_PROMPT)} />
                  ) : null}
                </HStack>
              }
            />
            {items.length === 0 ? (
              <EmptyState title={EMPTY[query.tab]} description={query.q === "" ? undefined : "Nothing matches this search."} headingLevel={2} />
            ) : (
              <List hasDividers density="balanced" aria-label="Intake items">
                {items.map((item) => {
                  const token = statusToken(item);
                  return (
                    <ListItem
                      key={item.id}
                      href={intakeHref(projectId, query.tab, query.q, item.work_item_id)}
                      isSelected={query.item === item.work_item_id}
                      startContent={<Icon icon={priorityOption(item.priority).icon} size="sm" color="secondary" />}
                      label={item.name}
                      description={
                        <Text type="supporting" color="secondary">
                          {item.key} · {item.created_by.name} via {sourceLabel(item.source)} · <RelativeTime value={item.created_at} hasTooltip={false} />
                        </Text>
                      }
                      endContent={token ? <Token label={token} size="sm" /> : undefined}
                    />
                  );
                })}
              </List>
            )}
          </LayoutPanel>
        }
        content={
          <LayoutContent padding={0} isScrollable label="Intake item">
            {query.item === null || children === undefined || children === null ? <EmptyState title="Select an intake item" headingLevel={2} /> : children}
          </LayoutContent>
        }
      />
      <CreateWorkItemDialog projectId={projectId} isOpen={createOpen} onOpenChange={setCreateOpen} mode="intake" />
    </>
  );
}

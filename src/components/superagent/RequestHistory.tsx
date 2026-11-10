"use client";

/**
 * "History" (decision 151; docs/contracts/ui.md "Superagent control", item 3):
 * what the runner knows about the request the table selected (`?request=`):
 * its facts, the scope it works to, an open question, its sessions and its
 * events, newest first.
 */
import { Banner } from "@astryxdesign/core/Banner";
import { Heading } from "@astryxdesign/core/Heading";
import { Link } from "@astryxdesign/core/Link";
import { List, ListItem } from "@astryxdesign/core/List";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Table, pixel, proportional, type TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { RelativeTime } from "@/components/detail/RelativeTime";
import type { RequestDetail, RunnerResult, Session } from "@/lib/superagent/types";
import { PullRequestLink, StageLabel } from "./request-parts";
import { eventsNewestFirst, failureCopy, formatUsd, usdOf, type FailureContext } from "./superagent-format";

export type RequestHistoryProps = {
  /** The selected request's id, or null when none is selected. */
  requestId: string | null;
  /** The runner's detail for it (null when no request is selected). */
  detail: RunnerResult<RequestDetail> | null;
  /** "Not available: {title}." while the runner's state itself failed. */
  note: string | null;
  context: FailureContext;
};

function Muted({ children }: { children: string }) {
  return (
    <Text type="supporting" color="secondary">
      {children}
    </Text>
  );
}

const SESSION_COLUMNS: TableColumn<Session>[] = [
  { key: "role", header: "Role", width: pixel(96), renderCell: (row) => <Text>{row.role}</Text> },
  { key: "model", header: "Model", width: pixel(96), renderCell: (row) => <Text>{row.model}</Text> },
  { key: "effort", header: "Effort", width: pixel(88), renderCell: (row) => <Text>{row.effort}</Text> },
  { key: "cost", header: "Cost", width: pixel(88), align: "end", renderCell: (row) => <Text hasTabularNumbers>{formatUsd(row.costUsd)}</Text> },
  {
    key: "started",
    header: "Started",
    width: pixel(120),
    renderCell: (row) => <RelativeTime value={row.startedAt} type="supporting" color="secondary" hasTooltip={false} />,
  },
  {
    key: "ended",
    header: "Ended",
    width: pixel(120),
    renderCell: (row) =>
      row.endedAt === null ? <Muted>Running</Muted> : <RelativeTime value={row.endedAt} type="supporting" color="secondary" hasTooltip={false} />,
  },
  { key: "outcome", header: "Outcome", width: proportional(1, { minWidth: 136 }), renderCell: (row) => (row.outcome === null ? <Muted>—</Muted> : <Text>{row.outcome}</Text>) },
];

export function RequestHistory({ requestId, detail, note, context }: RequestHistoryProps) {
  return (
    <VStack gap={4} className="tessera-superagent-section">
      <Heading level={2}>
        History
      </Heading>
      {note !== null ? <Muted>{note}</Muted> : requestId === null || detail === null ? <Muted>Select a request to see its history.</Muted> : <HistoryBody detail={detail} context={context} />}
    </VStack>
  );
}

function HistoryBody({ detail, context }: { detail: RunnerResult<RequestDetail>; context: FailureContext }) {
  if (!detail.ok) {
    const copy = failureCopy(detail.failure, context);
    return <Banner status={copy.status} title={copy.title} description={copy.body} />;
  }
  const request = detail.data;
  const events = eventsNewestFirst(request.events);
  return (
    <VStack gap={4}>
      <Heading level={3}>{`${request.itemKey} ${request.title}`}</Heading>
      <MetadataList>
        <MetadataListItem label="Stage">
          <StageLabel stage={request.stage} hasReason />
        </MetadataListItem>
        <MetadataListItem label="Size">{request.size}</MetadataListItem>
        <MetadataListItem label="Deliverable">{request.deliverable}</MetadataListItem>
        <MetadataListItem label="Repo">{request.repo}</MetadataListItem>
        <MetadataListItem label="Cost">{usdOf(request.costUsd, request.budgetUsd)}</MetadataListItem>
        <MetadataListItem label="PR">
          <PullRequestLink pr={request.pr} />
        </MetadataListItem>
        <MetadataListItem label="Created">
          <RelativeTime value={request.createdAt} hasTooltip={false} />
        </MetadataListItem>
        <MetadataListItem label="Updated">
          <RelativeTime value={request.updatedAt} hasTooltip={false} />
        </MetadataListItem>
        {request.planPageId === null ? null : (
          <MetadataListItem label="Plan page">
            <Link href={`/pages/${request.planPageId}`} className="tessera-superagent-link">
              Open the plan
            </Link>
          </MetadataListItem>
        )}
      </MetadataList>
      <VStack gap={1}>
        <Heading level={3}>
          Scope
        </Heading>
        <Text display="block" className="tessera-superagent-scope">{request.scope}</Text>
      </VStack>
      {request.question === null ? null : <Banner status="info" title="Open question" description={request.question} />}
      <VStack gap={2}>
        <Heading level={3}>
          Sessions
        </Heading>
        {request.sessions.length === 0 ? (
          <Muted>No sessions yet.</Muted>
        ) : (
          <Table<Session> aria-label="Sessions" density="compact" idKey="id" data={request.sessions} columns={SESSION_COLUMNS} />
        )}
      </VStack>
      <VStack gap={2}>
        <Heading level={3}>
          Events
        </Heading>
        {events.length === 0 ? (
          <Muted>No events yet.</Muted>
        ) : (
          <List density="compact" hasDividers aria-label="Events">
            {events.map((event, index) => (
              <ListItem
                key={`${event.at}-${index}`}
                label={<Text>{event.text}</Text>}
                description={
                  <HStack gap={1} vAlign="center" wrap="wrap">
                    <RelativeTime value={event.at} type="supporting" color="secondary" hasTooltip={false} />
                    <Muted>{`· ${event.kind}`}</Muted>
                  </HStack>
                }
              />
            ))}
          </List>
        )}
      </VStack>
    </VStack>
  );
}

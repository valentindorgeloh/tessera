"use client";

/**
 * "Needs you" body (decision 145; docs/contracts/ui.md "Superagent control"):
 * the runner's requests as a table, the empty state, and below it the triage
 * rows that gave up. A row click selects the request (the History section
 * follows `?request=`); its key and PR links and its action controls keep
 * their own clicks. Approve, Retry and Lift hold run at once; Stop, Resize and
 * Budget open a dialog in the screen.
 */
import { useMemo, useTransition, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { Link } from "@astryxdesign/core/Link";
import { List, ListItem } from "@astryxdesign/core/List";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Table, pixel, proportional, type TableColumn, type TablePlugin } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { superagentRequestAction, superagentRetryTriageAction } from "@/app/actions/superagent";
import { RelativeTime } from "@/components/detail/RelativeTime";
import { useNarrowContainer } from "@/components/workspace-settings/use-narrow-container";
import type { RequestScope, RequestSummary, RunnerAction, TriageRow } from "@/lib/superagent/types";
import { RobotIcon } from "@/themes/catppuccin/icons";
import type { RequestDialog } from "./RequestDialogs";
import {
  ACTION_LABELS,
  actionFailureText,
  actionVerb,
  modelsLabel,
  primaryAction,
  sizeLabel,
  sortRequests,
  superagentHref,
  usdOf,
  type FailureContext,
} from "./superagent-format";
import { PullRequestLink, StageLabel } from "./request-parts";
import { useRunnerReport } from "./use-runner-report";

/** Below this container width the table shows Item, Stage and Actions only (docs/contracts/ui.md). */
export const REQUESTS_FULL_WIDTH = 640;

// Column floors: the full table scrolls inside its own region below the sum, the folded one (Item, Stage, Actions) fits a 325px phone column.
const ITEM_COLUMN = proportional(2, { minWidth: 144 });
const REPO_COLUMN = proportional(1, { minWidth: 80 });
const SIZE_COLUMN = pixel(88);
const STAGE_COLUMN = proportional(2, { minWidth: 152 });
const MODELS_COLUMN = proportional(1, { minWidth: 88 });
const COST_COLUMN = proportional(1, { minWidth: 112 });
const PR_COLUMN = proportional(1, { minWidth: 88 });
const ACTIONS_COLUMN = pixel(152);
const ITEM_COLUMN_FOLDED = proportional(2, { minWidth: 96 });
const STAGE_COLUMN_FOLDED = proportional(2, { minWidth: 100 });
const ACTIONS_COLUMN_FOLDED = pixel(112);

type Row = { id: string; request: RequestSummary };

export type RequestsTableProps = {
  /** The runner's list, or null while it is not available (`note` says why). */
  requests: RequestSummary[] | null;
  /** The one line shown in place of the table when `requests` is null. */
  note: string | null;
  /** The triage rows (only the unavailable ones are listed), or null when they did not load. */
  triage: TriageRow[] | null;
  triageNote: string | null;
  context: FailureContext;
  scope: RequestScope;
  requestId: string | null;
  onOpenDialog: (dialog: RequestDialog) => void;
};

function stopClicks(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

export function RequestsTable({ requests, note, triage, triageNote, context, scope, requestId, onOpenDialog }: RequestsTableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const report = useRunnerReport(context);
  const { ref, isNarrow } = useNarrowContainer(REQUESTS_FULL_WIDTH);

  const run = (request: RequestSummary, action: "approve" | "retry" | "lift_hold") => {
    startTransition(async () => {
      const result = await superagentRequestAction({ request_id: request.id, action });
      report(result, actionFailureText(action, request.itemKey), `${actionVerb(action)} sent for ${request.itemKey}`);
    });
  };

  const choose = (request: RequestSummary, action: RunnerAction) => {
    if (action === "approve" || action === "retry" || action === "lift_hold") run(request, action);
    else onOpenDialog({ kind: action, request });
  };

  const retryTriage = (row: TriageRow) => {
    startTransition(async () => {
      const result = await superagentRetryTriageAction({ triage_id: row.id });
      report(result, `Could not re-triage ${row.itemKey}`, `Re-triage sent for ${row.itemKey}`);
    });
  };

  const rows = useMemo<Row[]>(() => sortRequests(requests ?? []).map((request) => ({ id: request.id, request })), [requests]);

  // A pointer click on the row selects it; Enter or Space on the focused row does the same (its own controls keep theirs).
  const open = useMemo<TablePlugin<Row>>(
    () => ({
      transformBodyRow: (props, row) => {
        const select = () => router.push(superagentHref(scope, row.request.id), { scroll: false });
        return {
          ...props,
          htmlProps: {
            ...props.htmlProps,
            className: "tessera-table-row",
            tabIndex: 0,
            "aria-current": row.request.id === requestId ? "true" : undefined,
            onClick: select,
            onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
              if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
              event.preventDefault();
              select();
            },
          },
        };
      },
      transformBodyCell: (props, column) =>
        column.key === "actions" ? { ...props, htmlProps: { ...props.htmlProps, onClick: stopClicks, onKeyDown: stopClicks } } : props,
    }),
    [requestId, scope, router],
  );

  const itemColumn: TableColumn<Row> = {
    key: "item",
    header: "Item",
    width: isNarrow ? ITEM_COLUMN_FOLDED : ITEM_COLUMN,
    renderCell: ({ request }) => (
      <VStack gap={0.5}>
        <Link href={`/work-items/${request.workItemId}`} onClick={stopClicks} className="tessera-superagent-link">
          {request.itemKey}
        </Link>
        <Text type="supporting" color="secondary">
          {request.title}
        </Text>
      </VStack>
    ),
  };
  const stageColumn: TableColumn<Row> = {
    key: "stage",
    header: "Stage",
    width: isNarrow ? STAGE_COLUMN_FOLDED : STAGE_COLUMN,
    renderCell: ({ request }) => <StageLabel stage={request.stage} hasReason />,
  };
  const actionsColumn: TableColumn<Row> = {
    key: "actions",
    header: "Actions",
    width: isNarrow ? ACTIONS_COLUMN_FOLDED : ACTIONS_COLUMN,
    align: "end",
    renderCell: ({ request }) => {
      if (request.actions.length === 0) return null;
      const primary = primaryAction(request.actions);
      return (
        <HStack gap={1} vAlign="center" hAlign="end" wrap="wrap">
          {primary === null ? null : (
            <Button variant="secondary" size="sm" label={`${ACTION_LABELS[primary]} ${request.itemKey}`} isDisabled={isPending} onClick={() => choose(request, primary)}>
              {ACTION_LABELS[primary]}
            </Button>
          )}
          <MoreMenu
            label={`Actions for ${request.itemKey}`}
            size="sm"
            alignment="end"
            isDisabled={isPending}
            items={request.actions.map((action) => ({
              id: action,
              label: ACTION_LABELS[action],
              variant: action === "stop" ? ("destructive" as const) : undefined,
              onClick: () => choose(request, action),
            }))}
          />
        </HStack>
      );
    },
  };
  const columns: TableColumn<Row>[] = isNarrow
    ? [itemColumn, stageColumn, actionsColumn]
    : [
        itemColumn,
        { key: "repo", header: "Repo", width: REPO_COLUMN, renderCell: ({ request }) => <Text>{request.repo}</Text> },
        { key: "size", header: "Size", width: SIZE_COLUMN, renderCell: ({ request }) => <Text>{sizeLabel(request.size, request.deliverable)}</Text> },
        stageColumn,
        { key: "models", header: "Models", width: MODELS_COLUMN, renderCell: ({ request }) => <Text>{modelsLabel(request.models)}</Text> },
        {
          key: "cost",
          header: "Cost",
          width: COST_COLUMN,
          renderCell: ({ request }) => <Text hasTabularNumbers>{usdOf(request.costUsd, request.budgetUsd)}</Text>,
        },
        {
          key: "pr",
          header: "PR",
          width: PR_COLUMN,
          renderCell: ({ request }) => <PullRequestLink pr={request.pr} onClick={stopClicks} />,
        },
        actionsColumn,
      ];

  const unavailable = triage?.filter((row) => row.status === "unavailable") ?? [];

  return (
    <VStack gap={4} ref={ref}>
      {requests === null ? (
        <Text type="supporting" color="secondary">
          {note}
        </Text>
      ) : requests.length === 0 ? (
        <EmptyState
          icon={<Icon icon={RobotIcon} size="lg" color="secondary" />}
          title="No requests"
          description="Assign or mention the superagent on a work item in a mapped project."
        />
      ) : (
        <Table<Row> aria-label="Requests" density="compact" idKey="id" data={rows} hasHover plugins={{ open }} columns={columns} />
      )}
      {triageNote === null ? null : (
        <Text type="supporting" color="secondary">
          {`Triage: ${triageNote}`}
        </Text>
      )}
      {unavailable.length === 0 ? null : (
        <List hasDividers header={<Heading level={3}>Triage unavailable</Heading>}>
          {unavailable.map((row) => (
            <ListItem
              key={row.id}
              label={row.itemKey}
              description={
                <VStack gap={0.5}>
                  <HStack gap={1} vAlign="center" wrap="wrap">
                    <Text type="supporting" color="secondary">{`Tried ${row.attempts} ${row.attempts === 1 ? "time" : "times"} · updated`}</Text>
                    <RelativeTime value={row.updatedAt} type="supporting" color="secondary" hasTooltip={false} />
                  </HStack>
                  {row.lastError === null ? null : (
                    <Text type="supporting" color="secondary">
                      {row.lastError}
                    </Text>
                  )}
                </VStack>
              }
              endContent={
                <Button variant="secondary" size="sm" label={`Re-triage ${row.itemKey}`} isDisabled={isPending} onClick={() => retryTriage(row)}>
                  Re-triage
                </Button>
              }
            />
          ))}
        </List>
      )}
    </VStack>
  );
}

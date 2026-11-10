/**
 * Server side of the superagent chat screen (decision 153; docs/contracts/ui.md
 * "Superagent chat"). Tessera is read first and the runner's request list is
 * added on top, so the page works with the runner offline: a runner failure is
 * a state in `requests` or `detail`, never thrown, while a Tessera error
 * propagates like on every other screen. Used by the two chat pages only.
 */
import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import {
  actor,
  getProject,
  getWorkItemByKey,
  getWorkspaceSettings,
  isTrackerError,
  listActors,
  listAgentConversations,
  listComments,
  listProjects,
  readTessera,
  type AgentConversationRow,
  type CommentView,
} from "@/lib/tessera/server";
import { connectRunner } from "./server";
import {
  SUPERAGENT_ACTOR_NAME,
  type ChatConversation,
  type ChatEntry,
  type ChatOpen,
  type ChatProject,
  type RequestSummary,
  type SuperagentChatLoad,
} from "./types";

/** What the first Tessera read hands back for the open item, before the runner's answer is known. */
type OpenRead =
  | { kind: "not_found" }
  | {
      kind: "item";
      item: { id: string; key: string; name: string; project_id: string; archived: boolean; description_md: string; created_at: string; created_by: string };
      projectName: string;
      /** Roots with their replies nested, as `listComments` returns them. */
      comments: CommentView[];
      actors: { id: string; name: string }[];
      descriptionActor: { name: string; kind: ChatEntry["actorKind"]; color: ChatEntry["actorColor"] } | null;
    };

const byTime = (a: { created_at: string; id: string }, b: { created_at: string; id: string }) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

/** The newest request per work item (largest `createdAt`). */
function newestByItem(requests: readonly RequestSummary[]): Map<string, RequestSummary> {
  const newest = new Map<string, RequestSummary>();
  for (const request of requests) {
    const held = newest.get(request.workItemId);
    if (!held || request.createdAt > held.createdAt) newest.set(request.workItemId, request);
  }
  return newest;
}

function entriesOf(read: Extract<OpenRead, { kind: "item" }>, flat: readonly CommentView[]): ChatEntry[] {
  const { item, descriptionActor } = read;
  const entries: ChatEntry[] = [];
  if (item.description_md.trim() !== "" && descriptionActor) {
    entries.push({
      id: "description",
      kind: "description",
      actorId: item.created_by,
      actorName: descriptionActor.name,
      actorKind: descriptionActor.kind,
      actorColor: descriptionActor.color,
      bodyMd: item.description_md,
      createdAt: item.created_at,
      isEdited: false,
    });
  }
  for (const c of flat) {
    entries.push({
      id: c.id,
      kind: c.parent_comment_id ? "reply" : "comment",
      actorId: c.actor_id,
      actorName: c.actor_name,
      actorKind: c.actor_kind,
      actorColor: c.actor_color,
      bodyMd: c.body_md,
      createdAt: c.created_at,
      isEdited: c.edited_at !== null,
    });
  }
  return entries;
}

/** The thread root the answer to the open question belongs under: found by `client_ref`, else by identical body; null when neither comment exists. */
function replyTarget(flat: readonly CommentView[], superagentId: string | null, requestId: string, question: string): string | null {
  if (superagentId === null) return null;
  const mine = flat.filter((c) => c.actor_id === superagentId);
  const prefix = `question:${requestId}:`;
  const newest = (list: readonly CommentView[]) => list.reduce<CommentView | null>((held, c) => (held === null || byTime(held, c) < 0 ? c : held), null);
  const found = newest(mine.filter((c) => c.client_ref?.startsWith(prefix))) ?? newest(mine.filter((c) => c.body_md.trim() === question.trim()));
  return found ? (found.parent_comment_id ?? found.id) : null;
}

export async function loadSuperagentChat({ itemKey }: { itemKey: string | null }): Promise<SuperagentChatLoad> {
  const { runnerUrl, tokenFile, client } = await connectRunner();
  const [requests, own] = await Promise.all([
    client.ok ? client.data.listRequests("all") : Promise.resolve(client),
    readTessera((ctx) => {
      const agents = getWorkspaceSettings(ctx).agents;
      const mapped = agents?.projects ?? [];
      const superagent = ctx.db
        .select({ id: actor.id })
        .from(actor)
        .where(and(eq(actor.kind, "agent"), eq(actor.name, SUPERAGENT_ACTOR_NAME), isNull(actor.deleted_at)))
        .get();
      const live = new Map(listProjects(ctx, {}).map((project) => [project.id, project]));
      const projects = mapped.flatMap((entry): ChatProject[] => {
        const project = live.get(entry.project_id);
        return project ? [{ id: project.id, name: project.name, identifier: project.identifier, repo: entry.repo }] : [];
      });
      const projectIds = mapped.map((entry) => entry.project_id);
      const rows = superagent ? listAgentConversations(ctx, { actor_id: superagent.id, project_ids: projectIds }) : [];
      let open: OpenRead | null = null;
      if (itemKey !== null) {
        try {
          const item = getWorkItemByKey(ctx, itemKey);
          const author = ctx.db.select({ name: actor.name, kind: actor.kind, color: actor.color }).from(actor).where(eq(actor.id, item.created_by)).get();
          open = {
            kind: "item",
            item: { id: item.id, key: item.key, name: item.name, project_id: item.project_id, archived: item.archived_at !== null, description_md: item.description_md, created_at: item.created_at, created_by: item.created_by },
            projectName: getProject(ctx, item.project_id).name,
            comments: listComments(ctx, item.id),
            actors: listActors(ctx).map((entry) => ({ id: entry.id, name: entry.name })),
            descriptionActor: author ?? null,
          };
        } catch (err) {
          if (!isTrackerError(err) || err.code !== "NOT_FOUND") throw err;
          open = { kind: "not_found" };
        }
      }
      return { userActorId: ctx.actor.id, superagentActorId: superagent?.id ?? null, projects, projectIds, rows, open };
    }),
  ]);

  const newest = requests.ok ? newestByItem(requests.data) : new Map<string, RequestSummary>();
  const openItem = own.open?.kind === "item" ? own.open.item : null;
  const openRequest = openItem ? (newest.get(openItem.id) ?? null) : null;

  // Request-only items, and the open item's detail, are independent: read both at once.
  const known = new Set(own.rows.map((row) => row.work_item_id));
  const mappedIds = new Set(own.projectIds);
  const { superagentActorId } = own;
  const extraIds = requests.ok ? [...new Set(requests.data.filter((r) => mappedIds.has(r.projectId) && !known.has(r.workItemId)).map((r) => r.workItemId))] : [];
  const [more, detail] = await Promise.all([
    superagentActorId !== null && extraIds.length > 0
      ? readTessera((ctx) => listAgentConversations(ctx, { actor_id: superagentActorId, project_ids: own.projectIds, extra_work_item_ids: extraIds }))
      : Promise.resolve<AgentConversationRow[]>([]),
    openRequest ? (client.ok ? client.data.getRequest(openRequest.id) : Promise.resolve(client)) : Promise.resolve(null),
  ]);

  const merged = new Map([...own.rows, ...more].map((row) => [row.work_item_id, row]));
  const conversations = [...merged.values()]
    .sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at) || a.key.localeCompare(b.key, undefined, { numeric: true }))
    .map((row): ChatConversation => ({
      workItemId: row.work_item_id,
      itemKey: row.key,
      title: row.name,
      projectId: row.project_id,
      projectName: row.project_name,
      isArchived: row.is_archived,
      lastMessage: row.last_comment ? { actorName: row.last_comment.actor_name, snippet: row.last_comment.snippet, at: row.last_comment.created_at } : null,
      lastActivityAt: row.last_activity_at,
      request: newest.get(row.work_item_id) ?? null,
    }));

  let open: ChatOpen | null = null;
  if (own.open?.kind === "not_found" && itemKey !== null) open = { kind: "not_found", itemKey };
  else if (own.open?.kind === "item") {
    const read = own.open;
    const flat = read.comments.flatMap((root) => [root, ...root.replies]).sort(byTime);
    const question = detail?.ok ? detail.data.question : null;
    open = {
      kind: "item",
      workItemId: read.item.id,
      itemKey: read.item.key,
      title: read.item.name,
      projectId: read.item.project_id,
      projectName: read.projectName,
      isArchived: read.item.archived,
      entries: entriesOf(read, flat),
      mentionActors: read.actors,
      request: openRequest,
      detail,
      replyToCommentId: openRequest && question !== null ? replyTarget(flat, own.superagentActorId, openRequest.id, question) : null,
    };
  }

  return { runnerUrl, tokenFile, requests, superagentActorId: own.superagentActorId, userActorId: own.userActorId, projects: own.projects, conversations, open };
}

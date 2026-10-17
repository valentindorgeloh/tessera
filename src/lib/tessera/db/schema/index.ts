export * from "./core";
export * from "./pages";
export * from "./collaboration";
export * from "./planning";
export * from "./workspace";
export * from "./hardening";
export * from "./ai";
import { actor, project, state, label, work_item, work_item_label, work_item_module, work_item_assignee, work_item_subscriber, cycle, moduleTable, module_member, module_link, work_item_link, view, view_settings, activity } from "./core";
import { page, page_label, page_version, page_embed } from "./pages";
import { work_item_relation, comment, comment_reaction, work_item_reaction, mention, notification } from "./collaboration";
import { draft_work_item, intake, intake_item, estimate, estimate_point } from "./planning";
import { favorite_folder, favorite, recent_visit, sticky, quick_link, workspace_settings } from "./workspace";
import { work_item_version, export_job, webhook, webhook_delivery, automation_lease } from "./hardening";
import { ai_proposal, ai_digest } from "./ai";

/** Passed to drizzle(client, { schema }) so relational queries and migrations see every table. */
export const schema = {
  actor,
  project,
  state,
  label,
  work_item,
  work_item_label,
  work_item_module,
  work_item_assignee,
  work_item_subscriber,
  cycle,
  module: moduleTable,
  module_member,
  module_link,
  work_item_link,
  view,
  view_settings,
  activity,
  page,
  page_label,
  page_version,
  page_embed,
  work_item_relation,
  comment,
  comment_reaction,
  work_item_reaction,
  mention,
  notification,
  draft_work_item,
  intake,
  intake_item,
  estimate,
  estimate_point,
  favorite_folder,
  favorite,
  recent_visit,
  sticky,
  quick_link,
  workspace_settings,
  work_item_version,
  export_job,
  webhook,
  webhook_delivery,
  automation_lease,
  ai_proposal,
  ai_digest,
};

export type TesseraSchema = typeof schema;

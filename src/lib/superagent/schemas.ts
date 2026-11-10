/**
 * zod mirrors of the superagent runner's API contract v1 (decision 152;
 * docs/contracts/ui.md "Superagent control"; the runner's own schemas in
 * `tessera-agents` stay the source of truth). Objects are plain `z.object`, so
 * unknown keys are stripped and an additive runner field never breaks the
 * screen; enums are exact, so a new stage or action is a `bad_response`.
 * Times are `z.string()` (ISO strings), money is a number in USD.
 */
import { z } from "zod";

const Count = z.number().int().nonnegative();

export const STAGE_KINDS = [
  "needs_delivery",
  "needs_question",
  "needs_signoff",
  "needs_hold",
  "needs_review",
  "needs_blocked",
  "needs_failed",
  "paused",
  "queued",
  "working",
  "done",
  "dropped",
  "stopped",
] as const;
export const StageKindSchema = z.enum(STAGE_KINDS);
export const StageSchema = z.object({ kind: StageKindSchema, label: z.string(), reason: z.string().nullable() });

export const RUNNER_ACTIONS = ["approve", "retry", "stop", "resize", "budget", "lift_hold", "withdraw"] as const;
export const RunnerActionSchema = z.enum(RUNNER_ACTIONS);
/** The actions that are one POST with no body (`lift_hold` is the route `lift-hold`; `withdraw` drops a failed delivery). */
export const SIMPLE_ACTIONS = ["approve", "retry", "stop", "lift_hold", "withdraw"] as const;
export const SimpleActionSchema = z.enum(SIMPLE_ACTIONS);

export const RequestSizeSchema = z.enum(["S", "M", "L"]);
export const DeliverableSchema = z.enum(["pr", "answer", "investigation"]);
export const PullRequestSchema = z.object({
  number: z.number().int(),
  url: z.string(),
  state: z.enum(["draft", "open", "merged", "closed"]),
});

export const RequestSummarySchema = z.object({
  id: z.string(),
  itemKey: z.string(),
  workItemId: z.string(),
  projectId: z.string(),
  repo: z.string(),
  title: z.string(),
  size: RequestSizeSchema,
  deliverable: DeliverableSchema,
  stage: StageSchema,
  models: z.array(z.string()),
  costUsd: z.number(),
  budgetUsd: z.number(),
  pr: PullRequestSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  actions: z.array(RunnerActionSchema),
});

export const SessionSchema = z.object({
  id: z.string(),
  role: z.string(),
  model: z.string(),
  effort: z.string(),
  costUsd: z.number(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  outcome: z.string().nullable(),
});
export const EventSchema = z.object({ at: z.string(), kind: z.string(), text: z.string() });
export const RequestDetailSchema = RequestSummarySchema.extend({
  scope: z.string(),
  question: z.string().nullable(),
  planPageId: z.string().nullable(),
  sessions: z.array(SessionSchema),
  events: z.array(EventSchema),
});

export const RunnerStateSchema = z.object({
  health: z.object({
    status: z.enum(["ok", "degraded", "setup_failed"]),
    checks: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string().nullable() })),
  }),
  paused: z.boolean(),
  pauseReason: z.enum(["manual", "daily_cap"]).nullable(),
  spend: z.object({ todayUsd: z.number(), dailyCapUsd: z.number() }),
  slots: z.object({ running: Count, max: Count }),
  counts: z.object({ needsYou: Count, working: Count, queued: Count }),
  intake: z.object({ rewound: z.boolean(), cursor: z.number().int(), latestSeq: z.number().int() }),
});

export const RunnerStatsSchema = z.object({
  bySize: z.array(z.object({ size: RequestSizeSchema, completed: Count, avgCostUsd: z.number() })),
  byModel: z.array(z.object({ model: z.string(), sessions: Count, costUsd: z.number() })),
  sizeChanged: z.object({ total: Count, changed: Count }),
  firstPassReviewRate: z.number().nullable(),
  escalations: z.array(z.object({ cause: z.string(), count: Count })),
});

export const TriageRowSchema = z.object({
  id: z.string(),
  itemKey: z.string(),
  status: z.enum(["queued", "running", "decided", "unavailable"]),
  attempts: Count,
  lastError: z.string().nullable(),
  updatedAt: z.string(),
});

/** The v1 text gives `revision` no type: kept as it came and passed back unchanged as `baseRevision`. */
export const RevisionSchema = z.union([z.string(), z.number()]);
export const RunnerSettingsSchema = z.object({
  budgetsUsd: z.object({ S: z.number(), M: z.number(), L: z.number() }),
  dailyCapUsd: z.number(),
  maxParallel: z.number().int(),
  signoffM: z.boolean(),
});
export const RunnerSettingsDocSchema = z.object({ settings: RunnerSettingsSchema, revision: RevisionSchema });

export const TeamSectionSchema = z.object({
  repo: z.string(),
  section: z.enum(["communication", "scope", "delivery"]),
  text: z.string(),
});
export const RunnerPromptsDocSchema = z.object({ teamSections: z.array(TeamSectionSchema), revision: RevisionSchema });

export const RunnerErrorBodySchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

// Envelopes of the routes that do not answer with the shape itself.
export const RequestsEnvelopeSchema = z.object({ requests: z.array(RequestSummarySchema) });
export const RequestDetailEnvelopeSchema = z.object({ request: RequestDetailSchema });
export const RequestEnvelopeSchema = z.object({ request: RequestSummarySchema });
export const TriageListEnvelopeSchema = z.object({ triage: z.array(TriageRowSchema) });
export const TriageEnvelopeSchema = z.object({ triage: TriageRowSchema });
export const PausedEnvelopeSchema = z.object({ paused: z.boolean() });

export type StageKind = z.infer<typeof StageKindSchema>;
export type Stage = z.infer<typeof StageSchema>;
export type RunnerAction = z.infer<typeof RunnerActionSchema>;
export type SimpleAction = z.infer<typeof SimpleActionSchema>;
export type RequestSize = z.infer<typeof RequestSizeSchema>;
export type Deliverable = z.infer<typeof DeliverableSchema>;
export type PullRequest = z.infer<typeof PullRequestSchema>;
export type RequestSummary = z.infer<typeof RequestSummarySchema>;
export type Session = z.infer<typeof SessionSchema>;
export type RequestEvent = z.infer<typeof EventSchema>;
export type RequestDetail = z.infer<typeof RequestDetailSchema>;
export type RunnerState = z.infer<typeof RunnerStateSchema>;
export type RunnerStats = z.infer<typeof RunnerStatsSchema>;
export type TriageRow = z.infer<typeof TriageRowSchema>;
export type Revision = z.infer<typeof RevisionSchema>;
export type RunnerSettings = z.infer<typeof RunnerSettingsSchema>;
export type RunnerSettingsDoc = z.infer<typeof RunnerSettingsDocSchema>;
export type TeamSection = z.infer<typeof TeamSectionSchema>;
export type RunnerPromptsDoc = z.infer<typeof RunnerPromptsDocSchema>;

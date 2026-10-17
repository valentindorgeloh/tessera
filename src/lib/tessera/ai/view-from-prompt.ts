/**
 * Describe a view (decision 36, decision 38). One non-beta structured call,
 * then a `create_view` proposal. No `fallbacks`: this namespace has none.
 * The rationale is stored on `preview.note` for the shared Apply row.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { AI_MODEL, aiEffort, assistantContext, getAnthropic } from "./client";
import { describeScope, VIEW_SYSTEM } from "./prompts";
import { createProposal, listProposals } from "./proposals";
import type { TesseraContext } from "../core/context";
import { rule } from "../core/errors";
import type { DbHandles } from "../db/client";
import { ai_proposal } from "../db/schema";
import { FiltersSchema } from "../schemas";
import { describeFilters } from "../tools/describe-filters";
import type { ProposalView } from "../types";
import { DisplayPatchSchema } from "../view-settings";

/**
 * Filters and display stay the stored schemas. `zodOutputFormat` (SDK 0.133)
 * moves keywords the API rejects (minLength, pattern, numeric bounds) into
 * the description, which `tests/ai/view-from-prompt.test.ts` locks. No
 * `rich_filters`: lists do not apply them until P10.
 */
export const ViewSpecSchema = z.object({
  name: z.string().min(1).max(255).describe("Short name of the view."),
  description: z.string().max(500).optional().describe("Optional sentence under the name."),
  filters: FiltersSchema.describe("List filters. Use ids from the scope block."),
  display: DisplayPatchSchema.describe("Display patch merged over the defaults."),
  rationale: z.string().describe("Why these filters and this display match the request."),
});

export type ViewSpec = z.infer<typeof ViewSpecSchema>;

export async function viewFromPrompt(
  handles: DbHandles,
  input: { project_id: string; prompt: string; conversation_id: string },
): Promise<ProposalView> {
  const ctx = assistantContext(handles);
  const proposals = listProposals(ctx, { conversation_id: input.conversation_id });
  const scopeBlock = describeScope(ctx, { project_id: input.project_id }, proposals);
  const message = await parseView(input.prompt, scopeBlock);
  if (message.stop_reason === "refusal" || message.parsed_output == null) {
    throw rule("view_not_generated", viewFailureText(message));
  }
  const spec = message.parsed_output;
  const proposal = createProposal(ctx, {
    conversation_id: input.conversation_id,
    source: "view_from_prompt",
    tool: "create_view",
    input: {
      project_id: input.project_id,
      name: spec.name,
      ...(spec.description !== undefined ? { description: spec.description } : {}),
      filters: spec.filters,
      display: spec.display,
    },
    project_id: input.project_id,
    tool_use_id: null,
  });
  return attachRationale(ctx, proposal, spec.rationale);
}

async function parseView(prompt: string, scopeBlock: string) {
  try {
    return await getAnthropic().messages.parse({
      model: AI_MODEL,
      max_tokens: 16_000,
      thinking: { type: "adaptive" },
      output_config: { effort: aiEffort(), format: zodOutputFormat(ViewSpecSchema) },
      system: [
        { type: "text", text: VIEW_SYSTEM, cache_control: { type: "ephemeral" } },
        { type: "text", text: `${scopeBlock}\n\ndescribe_filters:\n${JSON.stringify(describeFilters())}` },
      ],
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AnthropicError && err.message.includes("Failed to parse structured output")) {
      throw rule("view_not_generated", err.message);
    }
    throw err;
  }
}

function viewFailureText(message: { stop_details?: { explanation?: string | null } | null; content: { type: string; text?: string }[] }): string {
  const explanation = message.stop_details?.explanation;
  if (explanation) return explanation;
  const text = message.content
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("");
  return text.length > 0 ? text : "The model did not return a view.";
}

/** ASSUMPTION: createProposal does not take a note, so the rationale is written onto the stored preview after insert. */
function attachRationale(ctx: TesseraContext, proposal: ProposalView, rationale: string): ProposalView {
  const note = proposal.preview.note ? `${proposal.preview.note}. ${rationale}` : rationale;
  const preview = { ...proposal.preview, note };
  ctx.db.update(ai_proposal).set({ preview }).where(eq(ai_proposal.id, proposal.id)).run();
  return { ...proposal, preview };
}

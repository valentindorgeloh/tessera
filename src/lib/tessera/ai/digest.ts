/**
 * Digests on request (decision 37). An unchanged `input_seq` returns the
 * stored row and does not call the model. A refusal is `RULE digest_refused`.
 */
import { getCycleProgress } from "../cycles";
import { rule } from "../core/errors";
import type { DbHandles } from "../db/client";
import { getModuleProgress } from "../modules";
import type { DigestKind, DigestView } from "../types";
import { AI_BETAS, AI_FALLBACKS, AI_MODEL, aiEffort, assistantContext, getAnthropic } from "./client";
import { digestInputs, getStoredDigest, saveDigest } from "./digest-store";
import { DIGEST_SYSTEM } from "./prompts";

const DIGEST_MAX_TOKENS = 16_000;

export async function generateDigest(handles: DbHandles, kind: DigestKind, id: string): Promise<DigestView> {
  const ctx = assistantContext(handles);
  const inputs = digestInputs(ctx, kind, id);
  const stored = getStoredDigest(ctx, kind, id);
  if (stored && stored.input_seq === inputs.input_seq) return stored;

  // ASSUMPTION: digestInputs returns the subject name, activity and input_seq, not progress.
  // Progress is attached here so the digest can quote counts from the payload.
  const progress = kind === "cycle" ? getCycleProgress(ctx, id) : getModuleProgress(ctx, id);
  const response = await getAnthropic().beta.messages.create({
    model: AI_MODEL,
    max_tokens: DIGEST_MAX_TOKENS,
    thinking: { type: "adaptive" },
    output_config: { effort: aiEffort() },
    betas: [...AI_BETAS],
    fallbacks: AI_FALLBACKS,
    system: DIGEST_SYSTEM,
    messages: [{ role: "user", content: JSON.stringify({ ...inputs, progress }) }],
  });
  if (response.stop_reason === "refusal") {
    const explanation = response.stop_details?.explanation ?? "The model refused to write the digest.";
    throw rule("digest_refused", explanation);
  }
  const body = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  return saveDigest(ctx, {
    kind,
    entity_id: id,
    input_seq: inputs.input_seq,
    body_md: body,
    model: response.model,
  });
}

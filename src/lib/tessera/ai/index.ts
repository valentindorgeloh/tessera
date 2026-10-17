/**
 * Public AI surface for `server.ts` (decision 34 keeps these out of the
 * engine barrel). A1 owns proposals, preview and the digest store; this
 * file re-exports them next to the model-call entry points.
 */
export { aiEffort, AI_MODEL, getAiStatus, setAnthropicForTests, toAiError } from "./client";
export { generateDigest } from "./digest";
export { runAssistant } from "./assistant";
export { viewFromPrompt, ViewSpecSchema } from "./view-from-prompt";
export { previewTool } from "./preview";
export {
  applyProposal,
  applyProposals,
  ApplyProposalsInput,
  createProposal,
  CreateProposalInput,
  discardProposals,
  getProposal,
  listProposals,
} from "./proposals";
export { currentDigestSeq, digestInputs, getStoredDigest, saveDigest } from "./digest-store";

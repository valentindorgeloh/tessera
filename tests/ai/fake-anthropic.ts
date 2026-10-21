/**
 * Scripted Anthropic client for the AI tests. No network. The implementation
 * lives in src/lib/tessera/ai/fake-client.ts so the Playwright server can
 * replay recorded turns with the same code (decision 124).
 */
export { fakeAnthropic } from "@/lib/tessera/ai/fake-client";
export type { FakeAnthropic, FakeScript, ScriptedParse, ScriptedTurn } from "@/lib/tessera/ai/fake-client";

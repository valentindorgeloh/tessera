/**
 * Server side of the superagent control client (decision 145): reads the
 * runner URL from the workspace settings (decision 144) and the token from
 * its file on every call, then hands a ready `RunnerClient` to the caller.
 * Used by the Superagent page (`loadSuperagent`) and the Server Actions in
 * `src/app/actions/superagent.ts`; never by a registry tool.
 */
import "server-only";
import { AGENT_RUNNER_DEFAULT_URL } from "@/lib/tessera/schemas";
import { getWorkspaceSettings, readTessera } from "@/lib/tessera/server";
import { createRunnerClient, type RunnerClient } from "./client";
import { readRunnerToken, tokenFilePath } from "./token";
import type { RequestScope, RunnerFailure, RunnerResult, SuperagentLoad } from "./types";

function failure(state: RunnerFailure["state"], message: string): RunnerResult<never> {
  return { ok: false, failure: { state, message, status: null, code: null } };
}

/**
 * Runner URL, token file and a client for them, or why there is none (a runner failure is a state, never thrown).
 * The URL comes from a Tessera database read, whose error propagates like on every other screen. The token is read
 * here and goes nowhere but the client.
 */
export async function connectRunner(): Promise<{ runnerUrl: string; tokenFile: string; client: RunnerResult<RunnerClient> }> {
  const tokenFile = tokenFilePath();
  const runnerUrl = await readTessera((ctx) => getWorkspaceSettings(ctx).agents?.runner_url ?? AGENT_RUNNER_DEFAULT_URL);
  const read = await readRunnerToken(tokenFile);
  if (read.kind === "missing") return { runnerUrl, tokenFile, client: failure("not_set_up", "No runner token file") };
  if (read.kind === "unreadable") return { runnerUrl, tokenFile, client: failure("token_unreadable", read.message) };
  return { runnerUrl, tokenFile, client: { ok: true, data: createRunnerClient({ baseUrl: runnerUrl, token: read.token }) } };
}

function viaClient<T>(client: RunnerResult<RunnerClient>, run: (client: RunnerClient) => Promise<RunnerResult<T>>): Promise<RunnerResult<T>> {
  return client.ok ? run(client.data) : Promise.resolve(client);
}

/**
 * Runs `run` with a client for the configured runner. A missing or empty
 * token file is `not_set_up` and an unreadable one `token_unreadable`, both
 * without any request. Runner failures come back as states; a Tessera
 * database error from reading the runner URL propagates.
 */
export async function withRunner<T>(run: (client: RunnerClient) => Promise<RunnerResult<T>>): Promise<RunnerResult<T>> {
  const { client } = await connectRunner();
  return viaClient(client, run);
}

/** Everything the Superagent screen reads, the runner calls in parallel (`request` only when `requestId` is set). */
export async function loadSuperagent({ scope, requestId }: { scope: RequestScope; requestId?: string | null }): Promise<SuperagentLoad> {
  const { runnerUrl, tokenFile, client } = await connectRunner();
  const [state, requests, triage, stats, settings, prompts, request] = await Promise.all([
    viaClient(client, (c) => c.getState()),
    viaClient(client, (c) => c.listRequests(scope)),
    viaClient(client, (c) => c.listTriage()),
    viaClient(client, (c) => c.getStats()),
    viaClient(client, (c) => c.getSettings()),
    viaClient(client, (c) => c.getPrompts()),
    requestId ? viaClient(client, (c) => c.getRequest(requestId)) : Promise.resolve(null),
  ]);
  return { runnerUrl, tokenFile, state, requests, triage, stats, settings, prompts, request };
}

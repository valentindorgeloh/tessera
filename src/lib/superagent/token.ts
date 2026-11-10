/**
 * Where the runner's bearer token lives and how it is read (decision 151).
 * The token is never stored in Tessera: the file is read on every call, so a
 * restarted runner that wrote a new token needs no action here. Node `fs`
 * only, no `server-only`, so Vitest imports it; the caller never logs or
 * returns the token.
 */
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type RunnerTokenRead =
  | { kind: "ok"; token: string }
  /** No file, or one with nothing but whitespace: the runner has not been set up. */
  | { kind: "missing" }
  /** The file exists but cannot be read. `message` names the error code, never the content. */
  | { kind: "unreadable"; message: string };

/**
 * `TESSERA_AGENTS_TOKEN_FILE` (a leading `~/` is the home directory, a
 * relative path is against the process's working directory), else
 * `<home>/.tessera-agents/api-token`.
 */
export function tokenFilePath(env: Record<string, string | undefined> = process.env): string {
  const configured = env.TESSERA_AGENTS_TOKEN_FILE?.trim();
  if (configured === undefined || configured === "") return path.join(os.homedir(), ".tessera-agents", "api-token");
  if (configured.startsWith("~/")) return path.join(os.homedir(), configured.slice(2));
  return path.resolve(configured);
}

function errorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : null;
}

export async function readRunnerToken(file: string): Promise<RunnerTokenRead> {
  let content: string;
  try {
    content = await readFile(file, "utf8");
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") return { kind: "missing" };
    return { kind: "unreadable", message: code ?? "read failed" };
  }
  const token = content.trim();
  return token === "" ? { kind: "missing" } : { kind: "ok", token };
}

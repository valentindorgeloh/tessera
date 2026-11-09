/**
 * Token file location and reading (src/lib/superagent/token.ts, decision 144). Only temp files: the real
 * `~/.tessera-agents/api-token` is never opened.
 */
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readRunnerToken, tokenFilePath } from "@/lib/superagent/token";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tessera-token-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("tokenFilePath", () => {
  it("defaults to <home>/.tessera-agents/api-token", () => {
    expect(tokenFilePath({})).toBe(path.join(os.homedir(), ".tessera-agents", "api-token"));
  });

  it("uses TESSERA_AGENTS_TOKEN_FILE when it is set", () => {
    expect(tokenFilePath({ TESSERA_AGENTS_TOKEN_FILE: "/var/run/agents/token" })).toBe("/var/run/agents/token");
  });

  it("expands a leading ~/ to the home directory", () => {
    expect(tokenFilePath({ TESSERA_AGENTS_TOKEN_FILE: "~/secrets/runner-token" })).toBe(path.join(os.homedir(), "secrets", "runner-token"));
  });

  it("resolves a relative path against the working directory", () => {
    expect(tokenFilePath({ TESSERA_AGENTS_TOKEN_FILE: "data/superagent/api-token" })).toBe(path.resolve("data/superagent/api-token"));
  });

  it("ignores an empty or blank variable", () => {
    const fallback = path.join(os.homedir(), ".tessera-agents", "api-token");
    expect(tokenFilePath({ TESSERA_AGENTS_TOKEN_FILE: "" })).toBe(fallback);
    expect(tokenFilePath({ TESSERA_AGENTS_TOKEN_FILE: "   " })).toBe(fallback);
  });

  it("reads process.env when no environment is passed", () => {
    vi.stubEnv("TESSERA_AGENTS_TOKEN_FILE", "/tmp/from-process-env");
    try {
      expect(tokenFilePath()).toBe("/tmp/from-process-env");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("readRunnerToken", () => {
  it("returns the token, trimmed of whitespace and the final newline", async () => {
    const file = path.join(dir, "ok");
    await writeFile(file, "  tok-abc123\n");
    expect(await readRunnerToken(file)).toEqual({ kind: "ok", token: "tok-abc123" });
  });

  it("reads the file again on every call", async () => {
    const file = path.join(dir, "rotating");
    await writeFile(file, "first");
    expect(await readRunnerToken(file)).toEqual({ kind: "ok", token: "first" });
    await writeFile(file, "second");
    expect(await readRunnerToken(file)).toEqual({ kind: "ok", token: "second" });
  });

  it("is missing when the file does not exist", async () => {
    expect(await readRunnerToken(path.join(dir, "absent"))).toEqual({ kind: "missing" });
    expect(await readRunnerToken(path.join(dir, "no-such-dir", "token"))).toEqual({ kind: "missing" });
  });

  it("is missing when the file is empty or only whitespace", async () => {
    const empty = path.join(dir, "empty");
    await writeFile(empty, "");
    expect(await readRunnerToken(empty)).toEqual({ kind: "missing" });
    const blank = path.join(dir, "blank");
    await writeFile(blank, " \n\t\r\n ");
    expect(await readRunnerToken(blank)).toEqual({ kind: "missing" });
  });

  it("is unreadable for a directory, naming EISDIR", async () => {
    const folder = path.join(dir, "folder");
    await mkdir(folder);
    expect(await readRunnerToken(folder)).toEqual({ kind: "unreadable", message: "EISDIR" });
  });

  // Mode 000 does not stop root, so the case only runs for an ordinary user.
  it.skipIf(process.getuid?.() === 0)("is unreadable without permission, naming EACCES and never the content", async () => {
    const file = path.join(dir, "locked");
    await writeFile(file, "tok-must-not-leak");
    await chmod(file, 0o000);
    try {
      const read = await readRunnerToken(file);
      expect(read).toEqual({ kind: "unreadable", message: "EACCES" });
      expect(JSON.stringify(read)).not.toContain("tok-must-not-leak");
    } finally {
      await chmod(file, 0o600);
    }
  });
});

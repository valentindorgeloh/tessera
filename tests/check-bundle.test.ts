/** The static bundle scanner (decision 125) on throwaway directories. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assistantUnavailableCopy } from "../src/components/ai/ai-status";
import { FORBIDDEN, scanBundle, scanText } from "../scripts/bundle-rules";

let dir: string;

function write(rel: string, body: string | Buffer): void {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "tessera-bundle-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("scanBundle", () => {
  it("passes a clean bundle", () => {
    write("chunks/app.js", 'console.log("hello");');
    write("css/app.css", "body{margin:0}");
    expect(scanBundle(dir)).toEqual({ files: 2, findings: [] });
  });

  it.each(FORBIDDEN)("flags %s with file, count and context", (needle) => {
    write("chunks/nested/leak.js", `var a="x";var b="${needle}";var c="${needle}";`);
    write("chunks/ok.js", "var ok=1;");
    const { findings } = scanBundle(dir);
    const hit = findings.find((finding) => finding.needle === needle);
    expect(hit).toMatchObject({ file: path.join("chunks", "nested", "leak.js"), count: 2 });
    expect(hit?.context).toContain(needle);
  });

  it("reports drizzle-orm/better-sqlite3 as itself and as the driver name", () => {
    write("a.js", 'import("drizzle-orm/better-sqlite3")');
    expect(scanBundle(dir).findings.map((finding) => finding.needle).sort()).toEqual(["better-sqlite3", "drizzle-orm/better-sqlite3"]);
  });

  it("accepts the assistant's reworded help text and flags the variable name, however it is quoted", () => {
    const copy = assistantUnavailableCopy({ available: false, reason: "no_credential" });
    expect(copy.description).not.toContain("ANTHROPIC");
    write("help.js", `var t=${JSON.stringify(copy.description)};`);
    expect(scanBundle(dir).findings).toEqual([]);
    write("env.js", `var t="set ANTHROPIC_API_KEY in .env.local";`);
    const { findings } = scanBundle(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ file: "env.js", needle: "ANTHROPIC", count: 1 });
  });

  it("is case sensitive and ignores binary assets", () => {
    write("lower.js", "var s='anthropic and Better-SQLite3';");
    write("font.woff2", Buffer.from("sk-ant-secret"));
    write("logo.png", Buffer.from("TESSERA_DB_PATH"));
    expect(scanBundle(dir)).toEqual({ files: 1, findings: [] });
  });

  it("throws for a missing directory", () => {
    expect(() => scanBundle(path.join(dir, "missing"))).toThrow(/not a directory/);
  });
});

describe("scanText", () => {
  it("has no allowed phrases: the old help text is flagged like any other use", () => {
    const text = "Run ant auth login, or set ANTHROPIC_API_KEY in .env.local. Also ANTHROPIC_AUTH_TOKEN";
    expect(scanText("x.js", text)).toEqual([expect.objectContaining({ needle: "ANTHROPIC", count: 2 })]);
  });
});

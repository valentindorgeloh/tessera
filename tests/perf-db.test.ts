/**
 * The perf-script guard (scripts/perf-db.ts, decision 115) refuses the user's
 * database however its path is spelled. Uses scratch files in a temp
 * directory; the real data/tessera.db is never opened or statted.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isProtectedDb, perfDbPath } from "../scripts/perf-db";

let dir = "";
let real = "";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "perf-db-"));
  real = path.join(dir, "tessera.db");
  fs.writeFileSync(real, "");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("perfDbPath", () => {
  it("refuses :memory: and the default database in its spelled form", () => {
    expect(() => perfDbPath(":memory:")).toThrow(/database file/);
    expect(() => perfDbPath(real, [real])).toThrow(/refusing/);
  });

  it("refuses another letter case of the protected file", () => {
    expect(() => perfDbPath(path.join(dir, "Tessera.db"), [real])).toThrow(/refusing/);
    expect(() => perfDbPath(path.join(dir, "TESSERA.DB"), [real])).toThrow(/refusing/);
  });

  it("refuses a symlink and a hard link to it", () => {
    fs.symlinkSync(real, path.join(dir, "sym.db"));
    fs.linkSync(real, path.join(dir, "hard.db"));
    expect(() => perfDbPath(path.join(dir, "sym.db"), [real])).toThrow(/refusing/);
    expect(() => perfDbPath(path.join(dir, "hard.db"), [real])).toThrow(/refusing/);
  });

  it("refuses a path reached through a symlinked directory", () => {
    const alias = path.join(os.tmpdir(), `perf-db-alias-${path.basename(dir)}`);
    fs.symlinkSync(dir, alias);
    try {
      expect(() => perfDbPath(path.join(alias, "tessera.db"), [real])).toThrow(/refusing/);
    } finally {
      fs.rmSync(alias, { force: true });
    }
  });

  it("refuses the -wal, -shm and -journal files", () => {
    for (const suffix of ["-wal", "-shm", "-journal", "-WAL"]) expect(() => perfDbPath(path.join(dir, `tessera.db${suffix}`), [real])).toThrow(/refusing/);
  });

  it("accepts a scratch database, existing or not", () => {
    const scratch = path.join(dir, "p11-perf.db");
    expect(perfDbPath(scratch, [real])).toBe(scratch);
    fs.writeFileSync(scratch, "");
    expect(isProtectedDb(scratch, [real])).toBe(false);
    expect(perfDbPath(path.join(dir, "nested", "other.db"), [real])).toBe(path.join(dir, "nested", "other.db"));
  });
});

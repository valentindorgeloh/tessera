/**
 * The last visited project (`tessera.lastProject.v1`, written by ProjectProvider
 * and read by the off-project shortcuts in src/components/shell/useShortcuts.ts):
 * deleting a project forgets it there, so `g c`, `n m` and the other
 * project-scoped shortcuts no longer push routes of a deleted project.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetLastProject } from "@/components/shell/useShortcuts";
import { LAST_PROJECT_STORAGE_KEY } from "@/components/work-items/project-provider";

const DELETED = "11111111-1111-7111-8111-111111111111";
const OTHER = "22222222-2222-7222-8222-222222222222";

describe("forgetLastProject", () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => void storage.delete(key),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the key the sidebar and the shortcuts read", () => {
    expect(LAST_PROJECT_STORAGE_KEY).toBe("tessera.lastProject.v1");
  });

  it("clears the pointer when it names the deleted project", () => {
    storage.set(LAST_PROJECT_STORAGE_KEY, DELETED);
    forgetLastProject(DELETED);
    expect(storage.has(LAST_PROJECT_STORAGE_KEY)).toBe(false);
  });

  it("keeps a pointer to another project, and does nothing without one", () => {
    storage.set(LAST_PROJECT_STORAGE_KEY, OTHER);
    forgetLastProject(DELETED);
    expect(storage.get(LAST_PROJECT_STORAGE_KEY)).toBe(OTHER);
    storage.clear();
    forgetLastProject(DELETED);
    expect(storage.size).toBe(0);
  });

  it("ignores blocked storage", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(() => forgetLastProject(DELETED)).not.toThrow();
  });
});

/**
 * TrackerError: the one error type the service layer throws
 * (docs/contracts/service-api.md). Adapters map `code` to HTTP, MCP and
 * Server Action results; `details` carries zod issues, conflicting ids or the
 * rule name.
 */
import type { z } from "zod";
import type { TrackerErrorCode } from "../types";

export class TrackerError extends Error {
  readonly code: TrackerErrorCode;
  readonly details?: unknown;

  constructor(code: TrackerErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "TrackerError";
    this.code = code;
    this.details = details;
  }
}

export function isTrackerError(err: unknown): err is TrackerError {
  return err instanceof TrackerError;
}

export function notFound(entity: string, id: string): TrackerError {
  return new TrackerError("NOT_FOUND", `${entity} ${id} not found`, { entity, id });
}

export function validation(issues: unknown, message = "Invalid input"): TrackerError {
  return new TrackerError("VALIDATION", message, issues);
}

export function conflict(message: string, details?: unknown): TrackerError {
  return new TrackerError("CONFLICT", message, details);
}

export function rule(name: string, message: string): TrackerError {
  return new TrackerError("RULE", message, { rule: name });
}

export function archived(message = "This entity is archived and read-only"): TrackerError {
  return new TrackerError("ARCHIVED", message);
}

export function locked(message = "This entity is locked"): TrackerError {
  return new TrackerError("LOCKED", message);
}

export function busy(message = "The database is busy; try again"): TrackerError {
  return new TrackerError("BUSY", message);
}

type IssueLine = { path: PropertyKey[]; message: string };

/** How far a union branch got: a longer path means the input matched more of that branch. */
function branchScore(lines: IssueLine[]): number {
  return Math.max(0, ...lines.map((line) => line.path.length * 2 + (line.message.includes("received undefined") ? 0 : 1)));
}

/**
 * One line per issue with its full path. A union issue (a recursive tree such
 * as the rich filters) carries no path of its own, so it is replaced by the
 * lines of the branch that matched deepest, which names the JSON path of the
 * offending node instead of a bare "Invalid input".
 */
function issueLines(issues: readonly z.core.$ZodIssue[], prefix: PropertyKey[] = []): IssueLine[] {
  return issues.flatMap((issue): IssueLine[] => {
    const path = [...prefix, ...issue.path];
    if (issue.code !== "invalid_union" || issue.errors.length === 0) return [{ path, message: issue.message }];
    let best: IssueLine[] = [];
    let bestScore = -1;
    for (const branch of issue.errors) {
      const lines = issueLines(branch, path);
      const score = branchScore(lines);
      if (score > bestScore) {
        best = lines;
        bestScore = score;
      }
    }
    return best;
  });
}

/**
 * Validates `input` with `schema` and throws VALIDATION with the zod issues
 * before any write happens. Every mutation calls this first.
 */
export function validateInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues;
    const summary = issueLines(issues).map((line) => `${line.path.join(".") || "input"}: ${line.message}`).join("; ");
    throw validation(issues, `Invalid input: ${summary}`);
  }
  return result.data;
}

type SqliteErrorLike = { code: string; message: string };

function isSqliteErrorLike(err: unknown): err is SqliteErrorLike {
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as { code?: unknown }).code === "string" &&
    typeof (err as { message?: unknown }).message === "string"
  );
}

/**
 * Maps better-sqlite3 errors to TrackerError: SQLITE_BUSY family to BUSY,
 * UNIQUE and PRIMARY KEY violations to CONFLICT. Anything else (including an
 * existing TrackerError) is returned unchanged so callers can rethrow it.
 */
export function fromSqliteError(err: unknown): unknown {
  if (isTrackerError(err) || !isSqliteErrorLike(err)) return err;
  if (err.code === "SQLITE_BUSY" || err.code.startsWith("SQLITE_BUSY_")) {
    return busy(`The database is busy: ${err.message}`);
  }
  if (err.code === "SQLITE_CONSTRAINT_UNIQUE" || err.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
    return conflict(`Already exists: ${err.message}`, { sqlite: err.code });
  }
  return err;
}

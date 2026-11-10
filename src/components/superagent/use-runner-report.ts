"use client";

/**
 * Tells the user how a runner call went (decision 151): an info Toast with the
 * success text, or an error Toast built from `failureCopy`. Returns whether the
 * call worked, so a dialog closes only on success.
 */
import { useToast } from "@astryxdesign/core/Toast";
import type { RunnerResult } from "@/lib/superagent/types";
import { failureCopy, failureToast, type FailureContext } from "./superagent-format";

export function useRunnerReport(context: FailureContext): <T>(result: RunnerResult<T>, failed: string, success: string) => boolean {
  const toast = useToast();
  return (result, failed, success) => {
    if (result.ok) {
      toast({ type: "info", body: success });
      return true;
    }
    toast({ type: "error", body: failureToast(failed, failureCopy(result.failure, context)) });
    return false;
  };
}

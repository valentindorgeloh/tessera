"use client";

/**
 * The banners at the top of the Superagent screen (decision 152; docs/contracts/ui.md
 * "Superagent control", item 0). A failed state load is one banner from
 * `failureCopy`; a loaded state adds Paused, Tessera history rewound and
 * Runner setup failed when they apply. Nothing renders when all is well.
 */
import { Banner } from "@astryxdesign/core/Banner";
import { VStack } from "@astryxdesign/core/Stack";
import type { RunnerResult, RunnerState } from "@/lib/superagent/types";
import { failureCopy, pausedBody, rewoundBody, setupFailedBody, type FailureContext } from "./superagent-format";

export function RunnerBanners({ state, context }: { state: RunnerResult<RunnerState>; context: FailureContext }) {
  if (!state.ok) {
    const copy = failureCopy(state.failure, context);
    return <Banner status={copy.status} title={copy.title} description={copy.body} />;
  }
  const { data } = state;
  const banners = [
    data.paused ? <Banner key="paused" status="info" title="Paused" description={pausedBody(data.pauseReason)} /> : null,
    data.intake.rewound ? (
      <Banner key="rewound" status="warning" title="Tessera history rewound" description={rewoundBody(data.intake.cursor, data.intake.latestSeq)} />
    ) : null,
    data.health.status === "setup_failed" ? (
      <Banner key="setup" status="error" title="Runner setup failed" description={setupFailedBody(data.health.checks)} />
    ) : null,
  ].filter((banner) => banner !== null);
  if (banners.length === 0) return null;
  return <VStack gap={3}>{banners}</VStack>;
}

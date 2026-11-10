"use client";

/**
 * The superagent setup guide (decision 155; docs/contracts/ui.md "Superagent control", "Setup guide"): a panel page
 * that walks a Tessera user through setting up the runner on a Mac. The "Where you are" block shows what Tessera can
 * check, then the 12 steps and the doctor troubleshooting list follow. The page (server) loads the status once;
 * "Check again" asks Next to reload it. There is no polling: the user works in Terminal and comes back.
 */
import { useTransition } from "react";
import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Stack";
import { superagentRefreshAction } from "@/app/actions/superagent";
import { PanelBar, PanelHeader, PanelPage, PanelTitle } from "@/components/shell/PanelHeader";
import type { SuperagentSetupLoad } from "@/lib/superagent/types";
import { RetryIcon } from "@/themes/catppuccin/icons";
import { GUIDE_INTRO, SETUP_STEPS } from "../setup-guide";
import { stepStates } from "../setup-status";
import { GuideText } from "./GuideText";
import { SetupStatusList } from "./SetupStatusList";
import { SetupStepSection } from "./SetupStepSection";
import { SetupTroubleshooting } from "./SetupTroubleshooting";

export type SetupGuideScreenProps = {
  load: SuperagentSetupLoad;
  /** `http://127.0.0.1:<port>` of this Tessera, or null when the page could not tell (step 9 then shows a placeholder). */
  tesseraUrl: string | null;
};

export function SetupGuideScreen({ load, tesseraUrl }: SetupGuideScreenProps) {
  const [isChecking, startCheck] = useTransition();
  const states = stepStates(load);
  const check = () => {
    startCheck(async () => {
      // Tessera's server may be restarting; a throw here would replace the screen with the error boundary.
      await superagentRefreshAction().catch(() => undefined);
    });
  };
  return (
    <PanelPage
      width="reading"
      header={
        <PanelHeader label="Set up the superagent">
          <PanelBar
            canWrap
            start={<PanelTitle>Set up the superagent</PanelTitle>}
            end={
              <>
                <Button variant="ghost" size="sm" label="Control screen" href="/agents/superagent" />
                <Button variant="secondary" size="sm" label="Check again" icon={<RetryIcon />} isLoading={isChecking} onClick={check} />
              </>
            }
          />
        </PanelHeader>
      }
    >
      <VStack gap={6} padding={4} className="tessera-setup-body">
        <VStack gap={2}>
          {GUIDE_INTRO.map((text, i) => (
            <GuideText key={`intro-${i}`} text={text} color={i === 0 ? "primary" : "secondary"} />
          ))}
        </VStack>
        <SetupStatusList load={load} />
        {SETUP_STEPS.map((step) => (
          <SetupStepSection key={step.id} step={step} state={states[step.id]} tesseraUrl={tesseraUrl} />
        ))}
        <SetupTroubleshooting />
      </VStack>
    </PanelPage>
  );
}

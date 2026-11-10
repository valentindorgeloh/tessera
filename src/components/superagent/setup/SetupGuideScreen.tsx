/**
 * The superagent setup guide (decision 155; docs/contracts/ui.md "Superagent control", "Setup guide"): a panel page
 * that walks a Tessera user through setting up the runner on a Mac. The "Where you are" block shows what Tessera can
 * check, then the 12 steps and the doctor troubleshooting list follow. The page (server) loads the status once;
 * "Check again" asks Next to reload it. There is no polling: the user works in Terminal and comes back.
 * A Server Component, like the step and troubleshooting parts: the guide's text never ships as browser code
 * (check:bundle forbids the API key's variable name there); "Check again" is the one client island.
 */
import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Stack";
import { PanelBar, PanelHeader, PanelPage, PanelTitle } from "@/components/shell/PanelHeader";
import type { SuperagentSetupLoad } from "@/lib/superagent/types";
import { GUIDE_INTRO, SETUP_STEPS } from "../setup-guide";
import { stepStates } from "../setup-status";
import { GuideText } from "./GuideText";
import { SetupCheckAgain } from "./SetupCheckAgain";
import { SetupStatusList } from "./SetupStatusList";
import { SetupStepSection } from "./SetupStepSection";
import { SetupTroubleshooting } from "./SetupTroubleshooting";

export type SetupGuideScreenProps = {
  load: SuperagentSetupLoad;
  /** `http://127.0.0.1:<port>` of this Tessera, or null when the page could not tell (step 9 then shows a placeholder). */
  tesseraUrl: string | null;
};

export function SetupGuideScreen({ load, tesseraUrl }: SetupGuideScreenProps) {
  const states = stepStates(load);
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
                <SetupCheckAgain />
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

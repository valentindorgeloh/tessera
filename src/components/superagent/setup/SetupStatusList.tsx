/**
 * The setup guide's "Where you are" block (decision 155; docs/contracts/ui.md "Superagent control", "Setup guide"):
 * four rows (token file, runner, mapped projects, the superagent's connection), each with a status dot and a link
 * to the step that fixes it. The rows come from `setupStatusRows`.
 */
import { Heading } from "@astryxdesign/core/Heading";
import { Link } from "@astryxdesign/core/Link";
import { List, ListItem } from "@astryxdesign/core/List";
import { VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import type { SuperagentSetupLoad } from "@/lib/superagent/types";
import { STATUS_NOTE } from "../setup-guide";
import { setupStatusRows, stepAnchor, stepLinkLabel } from "../setup-status";
import { GuideText } from "./GuideText";

export function SetupStatusList({ load }: { load: SuperagentSetupLoad }) {
  return (
    <VStack gap={3} className="tessera-setup-step">
      <Heading level={2}>Where you are</Heading>
      <List aria-label="Setup status" hasDividers density="compact">
        {setupStatusRows(load).map((row) => (
          <ListItem
            key={row.id}
            align="first-line"
            startContent={<StatusDot variant={row.variant} label={row.stateLabel} />}
            label={<Text weight="medium">{row.title}</Text>}
            description={<GuideText text={row.body} type="supporting" color="secondary" />}
            endContent={
              <Link href={stepAnchor(row.stepId)} label={`${stepLinkLabel(row.stepId)} (${row.title})`}>
                {stepLinkLabel(row.stepId)}
              </Link>
            }
          />
        ))}
      </List>
      <GuideText text={STATUS_NOTE} type="supporting" color="secondary" />
    </VStack>
  );
}

/**
 * "When a check fails" (decision 155): every `npm run doctor` check and exit code with the step that fixes it, then
 * the problems doctor does not catch. The content is data in `setup-guide.ts`.
 */
import type { ReactNode } from "react";
import { Code } from "@astryxdesign/core/Code";
import { Heading } from "@astryxdesign/core/Heading";
import { Link } from "@astryxdesign/core/Link";
import { List, ListItem } from "@astryxdesign/core/List";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { DOCTOR_CHECKS, DOCTOR_EXIT_CODES, OTHER_PROBLEMS, TROUBLESHOOTING_INTRO, type SetupStepId } from "../setup-guide";
import { stepAnchor, stepLinkLabel } from "../setup-status";
import { GuideText } from "./GuideText";
import { CommandBlock } from "./SetupStepSection";

/** The link to the step that fixes a row, or nothing when no step does. */
function stepLink(stepId: SetupStepId | null, what: string): ReactNode {
  if (stepId === null) return null;
  return (
    <Link href={stepAnchor(stepId)} label={`${stepLinkLabel(stepId)} (${what})`}>
      {stepLinkLabel(stepId)}
    </Link>
  );
}

export function SetupTroubleshooting() {
  return (
    <VStack gap={4} className="tessera-setup-step">
      <Heading level={2} id="setup-troubleshooting" className="tessera-setup-anchor">
        When a check fails
      </Heading>
      <GuideText text={TROUBLESHOOTING_INTRO} />
      <List aria-label="Doctor checks" hasDividers density="compact">
        {DOCTOR_CHECKS.map((check) => (
          <ListItem
            key={check.label}
            align="first-line"
            label={<Code>{check.label}</Code>}
            description={
              <VStack gap={1}>
                <GuideText text={check.meaning} type="supporting" color="secondary" />
                <Text type="supporting" color="secondary">{`Exit code ${check.exitCode}`}</Text>
              </VStack>
            }
            endContent={stepLink(check.stepId, check.label)}
          />
        ))}
      </List>
      <Heading level={3}>Exit codes</Heading>
      <List aria-label="Exit codes" hasDividers density="compact">
        {DOCTOR_EXIT_CODES.map((entry) => (
          <ListItem
            key={entry.code}
            align="first-line"
            label={<Text weight="medium">{`Exit code ${entry.code}`}</Text>}
            description={<GuideText text={entry.meaning} type="supporting" color="secondary" />}
            endContent={stepLink(entry.stepId, `exit code ${entry.code}`)}
          />
        ))}
      </List>
      <Heading level={3}>Other problems</Heading>
      <List aria-label="Other problems" hasDividers density="compact">
        {OTHER_PROBLEMS.map((problem) => (
          <ListItem
            key={problem.id}
            align="first-line"
            label={<Text weight="medium">{problem.title}</Text>}
            description={
              <VStack gap={2}>
                <GuideText text={problem.fix} type="supporting" color="secondary" />
                {problem.command ? <CommandBlock command={problem.command} /> : null}
              </VStack>
            }
            endContent={stepLink(problem.stepId, problem.title)}
          />
        ))}
      </List>
    </VStack>
  );
}

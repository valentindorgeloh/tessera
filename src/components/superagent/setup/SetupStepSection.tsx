"use client";

/**
 * One step of the setup guide (decision 155): a heading that doubles as the anchor, the step's state when a check
 * covers it, why it matters, a numbered list of actions (a command or a `config.json` fragment sits in a block with
 * a copy button) and when it is done. Plain sections, not Stepper or Collapsible (ui.md "Setup guide").
 */
import { Heading } from "@astryxdesign/core/Heading";
import { Link } from "@astryxdesign/core/Link";
import { List, ListItem } from "@astryxdesign/core/List";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { fillGuideText, type GuideStep } from "../setup-guide";
import { STEP_STATE_COPY, stepAnchor, stepNumber, type StepState } from "../setup-status";
import { GuideText } from "./GuideText";

export type SetupStepSectionProps = {
  step: GuideStep;
  /** Done, to do or not checked; null for a step no check covers (no badge). */
  state: StepState | null;
  /** This Tessera's address for step 9, or null. */
  tesseraUrl: string | null;
};

/** A single-line command in its own block: wraps on a phone, never scrolls sideways. */
export function CommandBlock({ command }: { command: string }) {
  return <CodeBlock code={command} language="bash" hasLanguageLabel={false} isWrapped size="sm" width="100%" />;
}

export function SetupStepSection({ step, state, tesseraUrl }: SetupStepSectionProps) {
  const n = stepNumber(step.id);
  const fill = (text: string) => fillGuideText(text, { tesseraUrl });
  return (
    <VStack gap={3} className="tessera-setup-step">
      <HStack gap={3} vAlign="center" wrap="wrap">
        <Heading level={2} id={stepAnchor(step.id).slice(1)} className="tessera-setup-anchor">
          {n === 0 ? step.title : `${n}. ${step.title}`}
        </Heading>
        {state === null ? null : (
          <HStack gap={2} vAlign="center">
            <StatusDot variant={STEP_STATE_COPY[state].variant} label={STEP_STATE_COPY[state].label} />
            <Text type="supporting" color="secondary">
              {STEP_STATE_COPY[state].label}
            </Text>
          </HStack>
        )}
      </HStack>
      <GuideText text={fill(step.why)} />
      <List listStyle="decimal" density="compact" edge="flush" aria-label={`What to do: ${step.title}`}>
        {step.actions.map((action, i) => (
          <ListItem
            key={`${step.id}-${i}`}
            align="first-line"
            label={
              <VStack gap={2} className="tessera-setup-action">
                <GuideText text={fill(action.text)} />
                {action.link ? (
                  <Link href={action.link.href} isExternalLink={action.link.href.startsWith("https://")}>
                    {action.link.label}
                  </Link>
                ) : null}
                {action.command ? <CommandBlock command={fill(action.command)} /> : null}
                {action.example ? <CodeBlock code={fill(action.example)} language="json" title="config.json" hasLanguageLabel={false} size="sm" width="100%" /> : null}
              </VStack>
            }
          />
        ))}
      </List>
      <GuideText text={`Done when: ${fill(step.doneWhen)}`} type="supporting" color="secondary" />
    </VStack>
  );
}

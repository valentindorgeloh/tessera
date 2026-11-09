"use client";

/**
 * Team sections of the superagent screen (decisions 144 and 145;
 * docs/contracts/ui.md "Screen /agents/superagent", item 6). The section draws
 * its own "Team sections" heading: one Collapsible per repository with three
 * text areas (Communication, Scope, Delivery) and one "Save team sections"
 * that sends every non-empty text, with the entries of repositories the form
 * does not show passed through unchanged, and the loaded revision. The form is
 * keyed by the revision, so a conflict (or any change by the runner) replaces
 * the texts with the latest ones. Disabled with the failure text while the
 * runner's prompts failed to load.
 */
import { useState, useTransition } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Heading } from "@astryxdesign/core/Heading";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { useToast } from "@astryxdesign/core/Toast";
import { superagentSavePromptsAction } from "@/app/actions/superagent";
import type { RunnerPromptsDoc, RunnerResult, TeamSection } from "@/lib/superagent/types";
import { AGENT_RUNNER_DEFAULT_URL } from "@/lib/tessera/schemas";
import { TEAM_SECTION_FIELDS, mergeTeamSections, notAvailableText, saveFailureToast, storedTeamText } from "./settings-format";

export type TeamSectionsSectionProps = {
  prompts: RunnerResult<RunnerPromptsDoc>;
  /** The mapped repositories plus those already in `teamSections`, sorted. */
  repos: string[];
};

/** Up to this many repositories start open; more start closed, except one that already has text. */
const OPEN_REPOS = 4;
const FORM_MAX_WIDTH = 560;
const TEXT_ROWS = 4;

export function TeamSectionsSection({ prompts, repos }: TeamSectionsSectionProps) {
  return (
    <VStack gap={3} maxWidth={FORM_MAX_WIDTH}>
      <Heading level={2}>Team sections</Heading>
      {/* ASSUMPTION: the props carry no runner URL, so the failure words use the default one (they name it only for "not answering" and "timed out"). */}
      {prompts.ok ? null : (
        <Text type="supporting" color="secondary">
          {notAvailableText(prompts.failure, AGENT_RUNNER_DEFAULT_URL)}
        </Text>
      )}
      {repos.length === 0 ? (
        <Text type="supporting" color="secondary">
          Map a project to a repository to write its team sections.
        </Text>
      ) : (
        <TeamSectionsForm key={prompts.ok ? `rev:${prompts.data.revision}` : "unavailable"} prompts={prompts} repos={repos} />
      )}
    </VStack>
  );
}

/** The edit of one repository and section; the key never collides, whatever characters a repository name has. */
function editKey(repo: string, section: TeamSection["section"]): string {
  return JSON.stringify([repo, section]);
}

function TeamSectionsForm({ prompts, repos }: TeamSectionsSectionProps) {
  const toast = useToast();
  const [isPending, startSave] = useTransition();
  const stored = prompts.ok ? prompts.data.teamSections : [];
  // Only what the user changed is kept here; every other field reads the stored text, so a repository mapped meanwhile appears without a reset.
  const [edits, setEdits] = useState<Readonly<Record<string, string>>>({});
  const isDisabled = !prompts.ok;
  const textOf = (repo: string, section: TeamSection["section"]) => edits[editKey(repo, section)] ?? storedTeamText(stored, repo, section);

  const save = () => {
    if (!prompts.ok) return;
    startSave(async () => {
      const result = await superagentSavePromptsAction({ team_sections: mergeTeamSections(repos, textOf, stored), base_revision: prompts.data.revision });
      if (result.ok) {
        toast({ type: "info", body: "Team sections saved" });
        return;
      }
      toast(saveFailureToast("Could not save the team sections", result.failure, AGENT_RUNNER_DEFAULT_URL));
    });
  };

  return (
    <VStack gap={3}>
      {repos.map((repo) => (
        <Collapsible key={repo} trigger={repo} defaultIsOpen={repos.length <= OPEN_REPOS || TEAM_SECTION_FIELDS.some(({ section }) => textOf(repo, section) !== "")}>
          <FormLayout>
            {TEAM_SECTION_FIELDS.map(({ section, label }) => (
              <TextArea
                key={section}
                label={label}
                rows={TEXT_ROWS}
                value={textOf(repo, section)}
                onChange={(value) => setEdits((current) => ({ ...current, [editKey(repo, section)]: value }))}
                isDisabled={isDisabled}
              />
            ))}
          </FormLayout>
        </Collapsible>
      ))}
      <Button variant="primary" size="sm" label="Save team sections" isLoading={isPending} isDisabled={isDisabled} onClick={save} />
    </VStack>
  );
}

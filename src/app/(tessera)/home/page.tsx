import { Suspense } from "react";
import { io } from "next/cache";
import { Card } from "@astryxdesign/core/Card";
import { Section } from "@astryxdesign/core/Section";
import { VStack } from "@astryxdesign/core/Stack";
import { List, ListItem } from "@astryxdesign/core/List";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { listProjects, readTessera } from "@/lib/tessera/server";
import type { Project } from "@/lib/tessera/types";

/**
 * Tessera Home at `/home` (moves to `/` in P6): the "Since you were last
 * here" widget (filled by P5 and P9) and the projects as rows. The shell is
 * static; the rows stream in under Suspense after `io()`.
 */
export default function HomePage() {
  return (
    <VStack className="tessera-home" gap={6} padding={6}>
      <Heading level={1}>Home</Heading>
      <Card>
        <VStack gap={1}>
          <Heading level={3}>Since you were last here</Heading>
          <Text color="secondary" as="p">
            Activity by agents and automations will show up here once the assistant and the inbox are wired in.
          </Text>
        </VStack>
      </Card>
      <Section padding={0}>
        <Suspense fallback={<ProjectRowsSkeleton />}>
          <ProjectRows />
        </Suspense>
      </Section>
    </VStack>
  );
}

function countsSummary(project: Project): string {
  const { total, by_state_group } = project.counts;
  const items = total === 1 ? "1 item" : `${total} items`;
  return `${items} · ${by_state_group.started} in progress · ${by_state_group.completed} done`;
}

async function ProjectRows() {
  await io();
  const projects = await readTessera((ctx) => listProjects(ctx, {}));
  return (
    <List header={<Heading level={2}>Projects</Heading>} hasDividers>
      {projects.length === 0 ? (
        <ListItem label="No projects yet" description="Create a project to start tracking work." />
      ) : (
        projects.map((project) => (
          <ListItem
            key={project.id}
            label={project.name}
            href={`/projects/${project.id}/work-items`}
            startContent={<Token label={project.identifier} size="sm" />}
            endContent={
              <Text type="supporting" color="secondary" hasTabularNumbers>
                {countsSummary(project)}
              </Text>
            }
          />
        ))
      )}
    </List>
  );
}

const SKELETON_ROWS = [0, 1, 2];

function ProjectRowsSkeleton() {
  return (
    <VStack gap={2} aria-busy="true" aria-label="Loading projects">
      <Skeleton height="var(--text-heading-2-size)" width="30%" />
      {SKELETON_ROWS.map((row) => (
        <Skeleton key={row} index={row + 1} height="var(--size-element-lg)" />
      ))}
    </VStack>
  );
}

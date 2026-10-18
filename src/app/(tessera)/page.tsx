import { Suspense } from "react";
import { io } from "next/cache";
import { Card } from "@astryxdesign/core/Card";
import { VStack } from "@astryxdesign/core/Stack";
import { List, ListItem } from "@astryxdesign/core/List";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Heading, Text } from "@astryxdesign/core/Text";
import { PanelBar, PanelHeader, PanelPage, PanelTitle } from "@/components/shell/PanelHeader";
import { RecentsList } from "@/components/shell/RecentsList";
import { ProjectToken } from "@/components/work-items/ProjectFrame";
import { listProjects, readTessera } from "@/lib/tessera/server";
import type { Project } from "@/lib/tessera/types";

/**
 * Tessera Home at `/`: the recently visited pages, the "Since you were last
 * here" widget (filled by P5 and P9) and the projects as rows, in a reading
 * column under the panel header. The shell is static; the project rows stream
 * in under Suspense after `io()` and the recents load from localStorage after
 * mount.
 */
export default function HomePage() {
  return (
    <PanelPage
      width="reading"
      header={
        <PanelHeader label="Home">
          <PanelBar start={<PanelTitle>Home</PanelTitle>} />
        </PanelHeader>
      }
    >
      <VStack gap={6} padding={6}>
        <RecentsList />
        <Card>
          <VStack gap={1}>
            <Heading level={4} accessibilityLevel={2}>
              Since you were last here
            </Heading>
            <Text color="secondary" as="p">
              Activity by agents and automations will show up here once the assistant and the inbox are wired in.
            </Text>
          </VStack>
        </Card>
        <Suspense fallback={<ProjectRowsSkeleton />}>
          <ProjectRows />
        </Suspense>
      </VStack>
    </PanelPage>
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
    <List
      header={
        <Heading level={4} accessibilityLevel={2}>
          Projects
        </Heading>
      }
      hasDividers
      edgeCompensation="inline"
    >
      {projects.length === 0 ? (
        <ListItem label="No projects yet" description="Create a project to start tracking work." />
      ) : (
        projects.map((project) => (
          <ListItem
            key={project.id}
            label={project.name}
            href={`/projects/${project.id}/work-items`}
            startContent={<ProjectToken project={project} size="sm" />}
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
      <Skeleton height="var(--text-body-size)" width="30%" />
      {SKELETON_ROWS.map((row) => (
        <Skeleton key={row} index={row + 1} height="var(--size-element-lg)" />
      ))}
    </VStack>
  );
}

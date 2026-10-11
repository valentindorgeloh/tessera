import { Suspense } from "react";
import { io } from "next/cache";
import { List, ListItem } from "@astryxdesign/core/List";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { ArchivedProjectsLink } from "@/components/planning/ArchivedProjects";
import { NewProjectButton } from "@/components/projects/CreateProjectDialog";
import { ProjectToken } from "@/components/work-items/ProjectFrame";
import { listProjects, readTessera } from "@/lib/tessera/server";

/** Projects list at `/projects` (docs/contracts/ui.md "Projects"): one row per project linking to its work items; the header links to the archived projects (P3). */
export default function ProjectsPage() {
  return (
    <VStack className="tessera-projects" gap={5} padding={6}>
      <HStack vAlign="center" hAlign="between">
        <Heading level={1}>Projects</Heading>
        <HStack gap={4} vAlign="center">
          <ArchivedProjectsLink />
          <NewProjectButton />
        </HStack>
      </HStack>
      <Suspense fallback={<RowsSkeleton />}>
        <ProjectRows />
      </Suspense>
    </VStack>
  );
}

function describeCounts(total: number, started: number, completed: number): string {
  if (total === 0) return "No work items yet";
  const parts = [`${total} ${total === 1 ? "work item" : "work items"}`];
  if (started > 0) parts.push(`${started} in progress`);
  if (completed > 0) parts.push(`${completed} done`);
  return parts.join(" · ");
}

async function ProjectRows() {
  await io();
  const projects = await readTessera((ctx) => listProjects(ctx, {}));
  if (projects.length === 0) {
    return (
      <Text color="secondary">No projects yet. Create one to start tracking work.</Text>
    );
  }
  return (
    <List hasDividers>
      {projects.map((project) => (
        <ListItem
          key={project.id}
          label={project.name}
          description={describeCounts(project.counts.total, project.counts.by_state_group.started, project.counts.by_state_group.completed)}
          href={`/projects/${project.id}/work-items`}
          startContent={<ProjectToken project={{ identifier: project.identifier, logo: project.logo }} />}
        />
      ))}
    </List>
  );
}

function RowsSkeleton() {
  return (
    <VStack gap={2}>
      <Skeleton height={44} />
      <Skeleton height={44} index={1} />
      <Skeleton height={44} index={2} />
    </VStack>
  );
}

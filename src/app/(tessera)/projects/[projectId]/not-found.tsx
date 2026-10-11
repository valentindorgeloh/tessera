"use client";

import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { VStack } from "@astryxdesign/core/Stack";
import { NotFoundScreen } from "@/components/shell/NotFoundScreen";
import { useOptionalProject } from "@/components/work-items/project-provider";

/**
 * Not-found boundary under the project layout. Every page below looks the
 * project up and calls `notFound()` when it is missing, so this boundary
 * renders in two situations: inside the project frame, when a work item does
 * not exist or belongs to another project, and bare, when the project itself
 * is unknown and the layout rendered the page without a frame. The project
 * context tells the two apart.
 */
export default function ProjectNotFound() {
  const project = useOptionalProject();
  if (!project) return <NotFoundScreen />;
  return (
    <VStack padding={6}>
      <EmptyState
        title="Not found in this project"
        description="It may have been deleted, moved to another project, or the link is wrong."
        actions={<Button label="All work items" variant="primary" href={`/projects/${project.bundle.project.id}/work-items`} />}
      />
    </VStack>
  );
}

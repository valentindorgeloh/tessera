import {Suspense} from "react";
import {WorkspaceScreen} from "./workspace-screen";

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <WorkspaceScreen parentId={null} />
    </Suspense>
  );
}

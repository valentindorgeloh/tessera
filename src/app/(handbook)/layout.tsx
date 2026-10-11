import {Suspense, type ReactNode} from "react";
import {WorkspaceFrame} from "../workspace-frame";

/** Legacy handbook frame for `/` and `/items/[id]`; removed with the handbook in P6. */
export default function HandbookLayout({children}: {children: ReactNode}) {
  return (
    <Suspense fallback={null}>
      <WorkspaceFrame>{children}</WorkspaceFrame>
    </Suspense>
  );
}

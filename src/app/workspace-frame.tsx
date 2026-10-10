import {connection} from "next/server";
import type {ReactNode} from "react";
import {listNodes} from "../lib/workspace";
import {WorkspaceShell} from "./workspace-shell";

export async function WorkspaceFrame({children}: {children: ReactNode}) {
  await connection();
  const nodes = await listNodes();
  return <WorkspaceShell nodes={nodes}>{children}</WorkspaceShell>;
}

import { redirect } from "next/navigation";

/** Workspace settings index. The tabs live at `/settings/general` and `/settings/ai`. */
export default function WorkspaceSettingsIndex() {
  redirect("/settings/general");
}

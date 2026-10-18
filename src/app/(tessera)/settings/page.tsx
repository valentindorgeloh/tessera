import { redirect } from "next/navigation";

/** Workspace settings index. Tabs live at `/settings/<tab>`. */
export default function WorkspaceSettingsIndex() {
  redirect("/settings/general");
}

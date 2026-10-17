import { GeneralSettings } from "@/components/project-settings/GeneralSettings";

/** `/projects/<id>/settings/general` (docs/drafts/p4-ui.md "Routes and data loading"): no reads, the project comes from the bundle the project layout loaded. */
export default function GeneralSettingsPage() {
  return <GeneralSettings />;
}

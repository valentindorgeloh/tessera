import { FeaturesSettings } from "@/components/project-settings/FeaturesSettings";

/** `/projects/<id>/settings/features` (docs/drafts/p4-ui.md "Routes and data loading"): no reads, the project comes from the bundle the project layout loaded. */
export default function FeaturesSettingsPage() {
  return <FeaturesSettings />;
}

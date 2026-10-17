import { AgentsSettings } from "@/components/project-settings/AgentsSettings";

/** `/projects/<id>/settings/agents` (docs/drafts/p4-ui.md "Routes and data loading"): no reads, the project and actors come from the bundle the project layout loaded. */
export default function AgentsSettingsPage() {
  return <AgentsSettings />;
}

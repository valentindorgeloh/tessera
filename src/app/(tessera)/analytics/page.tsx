import { redirect } from "next/navigation";

/** `/analytics` opens the overview tab (docs/drafts/p9-plan.md U4). */
export default function AnalyticsIndexPage() {
  redirect("/analytics/overview");
}

import { redirect } from "next/navigation";

/** `/your-work` opens the summary (docs/drafts/p9-plan.md U3). */
export default function YourWorkPage() {
  redirect("/your-work/summary");
}

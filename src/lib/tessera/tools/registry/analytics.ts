import { getAnalytics, GetAnalyticsInput } from "../../analytics";
import { defineTool } from "../define";

export const analyticsTools = [
  defineTool({
    name: "get_analytics",
    title: "Get analytics",
    description:
      "Returns the overview, work-items, cycles or modules analytics tab. Totals match get_counts for the same live projects. Points fails with RULE points_unavailable unless every project in scope has an active points estimate. state is only valid for one project.",
    input: GetAnalyticsInput,
    mutates: false,
    core: true,
    phase: "P9",
    run: (ctx, input) => getAnalytics(ctx, input),
  }),
];

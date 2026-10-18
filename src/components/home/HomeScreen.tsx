"use client";

/**
 * Home at `/` (docs/drafts/p9-plan.md U1). Widgets follow `summary.widgets`;
 * a widget that is off is skipped. Recents are the only client-side widget.
 */
import { useState } from "react";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { VStack } from "@astryxdesign/core/Stack";
import { PanelBar, PanelHeader, PanelPage, PanelTitle } from "@/components/shell/PanelHeader";
import "@/components/styles/home.css";
import { SlidersIcon } from "@/themes/catppuccin/icons";
import { isHomeWidgetId, type HomeSummary, type HomeWidgetId } from "./home-format";
import { ManageWidgetsDialog } from "./ManageWidgetsDialog";
import { QuickLinksWidget } from "./QuickLinksWidget";
import { RecentsWidget } from "./RecentsWidget";
import { SinceLastVisit } from "./SinceLastVisit";
import { StickiesWidget } from "./StickiesWidget";
import { YourWorkWidget } from "./YourWorkWidget";

export type HomeScreenProps = {
  summary: HomeSummary;
  digestEnabled: boolean;
};

export function HomeScreen({ summary, digestEnabled }: HomeScreenProps) {
  const [managing, setManaging] = useState(false);
  const widgets = summary.widgets.filter((item): item is { widget: HomeWidgetId; enabled: boolean } => item.enabled && isHomeWidgetId(item.widget));
  return (
    <PanelPage
      width="reading"
      header={
        <PanelHeader label="Home">
          <PanelBar
            start={<PanelTitle>Home</PanelTitle>}
            end={
              <MoreMenu
                label="Home actions"
                size="sm"
                items={[{ id: "widgets", label: "Manage widgets…", icon: <SlidersIcon />, onClick: () => setManaging(true) }]}
              />
            }
          />
        </PanelHeader>
      }
    >
      <VStack gap={6} padding={6}>
        {widgets.length === 0 ? (
          <EmptyState title="All widgets are hidden" description="Manage widgets to show Since you were last here, quick links, recents, your work or stickies." />
        ) : (
          widgets.map((item) => <HomeWidget key={item.widget} id={item.widget} summary={summary} digestEnabled={digestEnabled} />)
        )}
      </VStack>
      <ManageWidgetsDialog widgets={summary.widgets} isOpen={managing} onOpenChange={setManaging} />
    </PanelPage>
  );
}

function HomeWidget({ id, summary, digestEnabled }: { id: HomeWidgetId; summary: HomeSummary; digestEnabled: boolean }) {
  switch (id) {
    case "since_last_visit":
      return <SinceLastVisit since={summary.since} digest={summary.digest} digestEnabled={digestEnabled} />;
    case "quick_links":
      return <QuickLinksWidget links={summary.quick_links} />;
    case "recents":
      return <RecentsWidget />;
    case "your_work":
      return <YourWorkWidget numbers={summary.your_work} />;
    case "stickies":
      return <StickiesWidget stickies={summary.stickies} />;
  }
}

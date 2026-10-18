"use client";

/**
 * Your work and an agent profile (docs/drafts/p9-plan.md U3). The header is
 * the actor; the tabs are links. Summary, activity and the work lists arrive
 * as children.
 */
import type { ReactNode } from "react";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Token } from "@astryxdesign/core/Token";
import { RememberLabel } from "@/components/profile/RememberLabel";
import { ACCESS_LABEL, KIND_LABEL, PROFILE_TABS, TAB_LABELS } from "@/components/profile/profile-format";
import { PanelBar, PanelHeader, PanelTitle } from "@/components/shell/PanelHeader";
import type { ProfileActor, ProfileTab } from "@/lib/tessera/types";

export type ProfileScreenProps = {
  actor: ProfileActor;
  tab: ProfileTab;
  /** `/your-work` or `/agents/<id>`, with the tab appended. */
  basePath: string;
  children: ReactNode;
};

export function ProfileScreen({ actor, tab, basePath, children }: ProfileScreenProps) {
  return (
    <Layout
      height="fill"
      header={
        <PanelHeader label={actor.name}>
          <PanelBar
            canWrap
            start={
              <>
                <Avatar name={actor.name} size="sm" tooltip={false} />
                <PanelTitle>{actor.name}</PanelTitle>
                <Token label={KIND_LABEL[actor.kind]} size="sm" />
                {actor.kind === "agent" ? <Token label={ACCESS_LABEL[actor.access]} size="sm" /> : null}
                <TabList value={tab} onChange={() => {}} size="sm" layout="hug" aria-label="Profile">
                  {PROFILE_TABS.map((item) => (
                    <Tab key={item} value={item} label={TAB_LABELS[item]} href={`${basePath}/${item}`} />
                  ))}
                </TabList>
              </>
            }
          />
        </PanelHeader>
      }
      content={
        <LayoutContent padding={0} isScrollable>
          <RememberLabel id={actor.id} label={actor.name} />
          {children}
        </LayoutContent>
      }
    />
  );
}

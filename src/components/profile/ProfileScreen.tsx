"use client";

/**
 * Your work and an agent profile (docs/drafts/p9-plan.md U3). The header is
 * the actor; the tabs are links. Summary, activity and the work lists arrive
 * as children. Below 600px the header is two rows (PanelBar `tabsBelow`): the
 * actor first, the tab strip full width under it.
 */
import type { ReactNode } from "react";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { HStack } from "@astryxdesign/core/Stack";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Token } from "@astryxdesign/core/Token";
import { RememberLabel } from "@/components/profile/RememberLabel";
import { ActorAvatar } from "@/components/shell/ActorAvatar";
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
            tabsBelow
            start={
              <>
                {/* One group for the actor, so the phone header's title row (shell.css tabs-below) keeps avatar, name and tokens together on one line. */}
                <HStack gap={2} vAlign="center" className="tessera-profile-title">
                  <ActorAvatar actor={actor} size="sm" tooltip={false} />
                  <PanelTitle className="tessera-profile-name">{actor.name}</PanelTitle>
                  {/* "You" would repeat the title on the user's own profile. */}
                  {actor.kind === "user" ? null : <Token label={KIND_LABEL[actor.kind]} size="sm" />}
                  {actor.kind === "agent" ? <Token label={ACCESS_LABEL[actor.access]} size="sm" /> : null}
                </HStack>
                <TabList value={tab} onChange={() => {}} size="sm" layout="hug" aria-label="Profile" className="tessera-profile-tabs">
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

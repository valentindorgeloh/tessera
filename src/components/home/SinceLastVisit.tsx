"use client";

/**
 * "Since you were last here" (docs/drafts/p9-plan.md U1). Opening Home does
 * not generate a digest and does not move the anchor. The anchor moves when
 * the route is hidden, the tab unloads, or Mark as seen is clicked.
 */
import { useEffect, useLayoutEffect, useRef, useTransition } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { List, ListItem } from "@astryxdesign/core/List";
import { Link } from "@astryxdesign/core/Link";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { markHomeSeenAction } from "@/app/actions/home";
import { DigestCard } from "@/components/ai/DigestCard";
import { useAiStatus } from "@/components/ai/AiStatusProvider";
import { RelativeTime } from "@/components/detail/RelativeTime";
import { ActorAvatar } from "@/components/shell/ActorAvatar";
import type { DigestView } from "@/lib/tessera/types";
import { isIsoTimestamp, sinceDescription, sinceKeyParts, sinceRowParts, type SinceEntry, type SinceLastVisit as SinceData } from "./home-format";

export type SinceLastVisitProps = {
  since: SinceData;
  digest: DigestView | null;
  /** False hides the digest card even when a summary is already stored. */
  digestEnabled: boolean;
};

function sendHomeSeen(seq: number): void {
  if (!Number.isInteger(seq) || seq < 0) return;
  const body = JSON.stringify({ seq });
  const blob = new Blob([body], { type: "application/json" });
  if (navigator.sendBeacon("/api/home/seen", blob)) return;
  void fetch("/api/home/seen", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
}

/**
 * Sends the newest seq when the tab unloads, and when Next hides the route
 * (the layout-effect cleanup). A strict-mode remount re-runs the effect in
 * the same turn, and that cleanup must not mark the visit as seen.
 */
function useHomeSeenBeacon(seq: number): void {
  const seqRef = useRef(seq);
  const alive = useRef(false);
  useEffect(() => {
    seqRef.current = seq;
  }, [seq]);
  useLayoutEffect(() => {
    alive.current = true;
    let sentOnHide = false;
    const onPageHide = () => {
      sentOnHide = true;
      sendHomeSeen(seqRef.current);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      const alreadySent = sentOnHide;
      const seqAtHide = seqRef.current;
      alive.current = false;
      queueMicrotask(() => {
        if (alive.current || alreadySent) return;
        sendHomeSeen(seqAtHide);
      });
    };
  }, []);
}

function SinceRow({ entry }: { entry: SinceEntry }) {
  const { actor, rest } = sinceRowParts(entry);
  const keyed = sinceKeyParts(entry, rest);
  return (
    <ListItem
      // The actor is its own truncating span at 480px and narrower (home.css), so a long
      // agent name cannot fill the two-line clamp. The full name stays in the DOM text,
      // so the link's accessible name keeps it (label-in-name); no aria-label here.
      // Astryx Text takes no `title`, so the shortened name has no native tooltip.
      // The work item key is a no-wrap run, so the clamp never breaks it at its hyphen.
      label={
        <Text className="tessera-home-since-label">
          <Text className="tessera-home-since-actor">{actor}</Text>
          {keyed === null ? (
            ` ${rest}`
          ) : (
            <>
              {` ${keyed.before}`}
              <Text textWrap="nowrap">{keyed.key}</Text>
              {keyed.after}
            </>
          )}
        </Text>
      }
      description={sinceDescription(entry.fields, entry.count)}
      href={entry.target.href === "" ? undefined : entry.target.href}
      startContent={<ActorAvatar actor={entry.actor} size="sm" tooltip={false} />}
      endContent={isIsoTimestamp(entry.last_at) ? <RelativeTime value={entry.last_at} type="supporting" color="secondary" hasTooltip={false} /> : null}
    />
  );
}

export function SinceLastVisit({ since, digest, digestEnabled }: SinceLastVisitProps) {
  const toast = useToast();
  const { status } = useAiStatus();
  const [isMarking, startMark] = useTransition();
  useHomeSeenBeacon(since.latest_seq);
  const canMark = since.anchor_seq !== since.latest_seq;
  const showDigest = digestEnabled && status?.available === true;

  const mark = () => {
    if (!canMark || isMarking) return;
    startMark(async () => {
      const result = await markHomeSeenAction(since.latest_seq);
      if (!result.ok) toast({ type: "error", body: `Could not mark this visit as seen. ${result.message}` });
    });
  };

  return (
    <VStack gap={4}>
      <Card>
        <VStack gap={4} className="tessera-home-since">
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Heading level={4} accessibilityLevel={2}>
              Since you were last here
            </Heading>
            {isIsoTimestamp(since.anchor_at) ? (
              <HStack gap={1} vAlign="center">
                <Text type="supporting" color="secondary">
                  Last visit
                </Text>
                <RelativeTime value={since.anchor_at} type="supporting" color="secondary" hasTooltip={false} />
              </HStack>
            ) : (
              <Text type="supporting" color="secondary">
                Last 7 days
              </Text>
            )}
          </HStack>
          {since.entries.length === 0 ? (
            <EmptyState isCompact title="Nothing new" description="Agents and automations have not changed anything since your last visit." />
          ) : (
            <List hasDividers>
              {since.entries.map((entry) => (
                <SinceRow key={`${entry.actor.id}:${entry.target.type}:${entry.target.id}`} entry={entry} />
              ))}
            </List>
          )}
          {since.more > 0 || canMark ? (
            <HStack gap={3} vAlign="center" wrap="wrap">
              {since.more > 0 ? <Link href="/inbox" className="tessera-home-more">{`+${since.more} more`}</Link> : null}
              <Button variant="secondary" size="sm" label="Mark as seen" onClick={mark} isLoading={isMarking} isDisabled={!canMark || isMarking} />
            </HStack>
          ) : null}
        </VStack>
      </Card>
      {showDigest ? <DigestCard kind="home" id="workspace" digest={digest} inset="none" /> : null}
    </VStack>
  );
}

"use client";

/**
 * Stored digest of a cycle, module or inbox (docs/drafts/p5-plan.md §6 "U3",
 * decision 37). Hidden while the assistant is unavailable and nothing is
 * stored. Summarise and Refresh post to `/api/ai/digest` and keep the answer
 * in local state; the page does not refresh.
 */
import { useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { Markdown } from "@astryxdesign/core/Markdown";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Token } from "@astryxdesign/core/Token";
import { useToast } from "@astryxdesign/core/Toast";
import { useAiStatus } from "@/components/ai/AiStatusProvider";
import { RelativeTime } from "@/components/detail/RelativeTime";
import { parseEntityHref } from "@/components/editor/links";
import { DigestViewSchema } from "@/lib/tessera/schemas";
import type { DigestKind, DigestView } from "@/lib/tessera/types";
import { SparkleIcon } from "@/themes/catppuccin/icons";

export type DigestCardProps = {
  kind: DigestKind;
  id: string;
  digest: DigestView | null;
  /**
   * `list` (the default) insets the card 16px from the edges of the list or panel it tops (inbox, cycle, module);
   * `none` leaves the margins to the column it sits in (the Home and Analytics widgets).
   */
  inset?: "list" | "none";
};

const WORK_LINK = /\bwork:([A-Z][A-Z0-9]{1,11}-\d+)\b/gi;

/** Bare `work:WEB-12` becomes a markdown link so `onLinkClick` can open it. Code and existing links stay as written. */
function linkWorkKeys(markdown: string): string {
  const parts = markdown.split(/(```[\s\S]*?```|`[^`\n]+`|\[[^\]]*\]\([^)]+\))/g);
  return parts.map((part, index) => (index % 2 === 1 ? part : part.replace(WORK_LINK, (href, key: string) => `[${key}](${href})`))).join("");
}

function messageOf(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null && "message" in body && typeof body.message === "string" && body.message !== "") return body.message;
  return fallback;
}

export function DigestCard({ kind, id, digest, inset = "list" }: DigestCardProps) {
  const router = useRouter();
  const toast = useToast();
  const { status } = useAiStatus();
  const available = status?.available === true;
  const [shown, setShown] = useState(digest);
  const [source, setSource] = useState(digest);
  const [isPending, setPending] = useState(false);
  if (digest !== source) {
    setSource(digest);
    setShown(digest);
  }

  if (!available && shown === null && !isPending) return null;

  const openWorkLink = (href: string, event: MouseEvent<HTMLAnchorElement>) => {
    const link = parseEntityHref(href);
    if (link?.scheme !== "work" || link.ref === "") return;
    event.preventDefault();
    router.push(`/browse/${link.ref}`);
  };

  const summarise = () => {
    if (isPending || !available) return;
    setPending(true);
    void (async () => {
      try {
        const response = await fetch("/api/ai/digest", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ kind, id }),
          cache: "no-store",
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          toast({ type: "error", body: messageOf(body, "Could not summarise") });
          return;
        }
        const parsed = DigestViewSchema.safeParse(body);
        if (!parsed.success) {
          toast({ type: "error", body: "Could not summarise" });
          return;
        }
        setShown(parsed.data);
      } catch {
        toast({ type: "error", body: "Could not summarise" });
      } finally {
        setPending(false);
      }
    })();
  };

  const action = !available || (shown !== null && !shown.is_stale) ? null : shown === null ? "Summarise" : "Refresh";

  return (
    <Card className={inset === "list" ? "tessera-ai-digest tessera-ai-digest--inset" : "tessera-ai-digest"}>
      <VStack gap={3} width="100%">
        <HStack gap={2} vAlign="center" hAlign="between" wrap="wrap">
          <HStack gap={2} vAlign="center">
            <Icon icon={SparkleIcon} size="sm" color="secondary" />
            <Heading level={3}>Digest</Heading>
          </HStack>
          <HStack gap={2} vAlign="center">
            {shown ? <RelativeTime value={shown.created_at} type="supporting" color="secondary" /> : null}
            {shown?.is_stale ? <Token label="Out of date" size="sm" color="yellow" /> : null}
          </HStack>
        </HStack>
        {isPending ? <Skeleton height={80} /> : null}
        {!isPending && shown ? (
          <Markdown density="compact" contentWidth={640} onLinkClick={openWorkLink}>
            {linkWorkKeys(shown.body_md)}
          </Markdown>
        ) : null}
        {action ? <Button variant="secondary" size="sm" label={action} onClick={summarise} isLoading={isPending} isDisabled={isPending} /> : null}
      </VStack>
    </Card>
  );
}

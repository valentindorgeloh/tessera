"use client";

/**
 * Describe a view (docs/drafts/p5-plan.md §6 "U3", decision 38). Generate
 * posts the prompt to `/api/ai/view` and shows the pending proposal.
 * ProposalRow's Apply runs `applyProposalsAction` as Assistant and opens
 * the created view. Errors stay on the text area.
 *
 * An empty conversation id is replaced with `crypto.randomUUID()` in the
 * Generate click (decision 35).
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { TextArea } from "@astryxdesign/core/TextArea";
import { applyProposalsAction, discardProposalsAction } from "@/app/actions/ai";
import { useAssistant } from "@/components/ai/AssistantProvider";
import { ProposalRow } from "@/components/ai/ProposalRow";
import { Dialog, DialogHeader } from "@/components/shell/dialogs";
import { ProposalViewSchema } from "@/lib/tessera/schemas";
import type { ApplyOutcome, ProposalView } from "@/lib/tessera/types";

export type ViewFromPromptDialogProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  projectId: string;
};

const PROMPT_MAX = 2000;

function messageOf(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null && "message" in body && typeof body.message === "string" && body.message !== "") return body.message;
  return fallback;
}

/** The assistant conversation's id, or a new uuid made in the click handler (decision 35). */
function conversationId(conversation: { id?: string } | null | undefined): string {
  if (conversation?.id) return conversation.id;
  return crypto.randomUUID();
}

function viewIdOf(data: unknown): string | null {
  if (typeof data !== "object" || data === null || !("id" in data)) return null;
  return typeof data.id === "string" && data.id !== "" ? data.id : null;
}

function withOutcome(proposal: ProposalView, outcome: ApplyOutcome): ProposalView {
  if (outcome.status === "applied") return { ...proposal, status: "applied", error: null, decided_at: proposal.decided_at };
  if (outcome.status === "failed") {
    return { ...proposal, status: "failed", error: outcome.error ?? { code: "INTERNAL", message: "Could not apply" } };
  }
  return proposal;
}

export function ViewFromPromptDialog({ isOpen, onOpenChange, projectId }: ViewFromPromptDialogProps) {
  const assistant = useAssistant();
  if (assistant.status?.available !== true) return null;
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={520} aria-label="Describe a view">
      {isOpen ? <DescribeForm projectId={projectId} conversation={assistant.conversation} onOpenChange={onOpenChange} /> : null}
    </Dialog>
  );
}

function DescribeForm({
  projectId,
  conversation,
  onOpenChange,
}: {
  projectId: string;
  conversation: { id?: string } | null | undefined;
  onOpenChange: (isOpen: boolean) => void;
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setPending] = useState(false);
  const [isDeciding, setDeciding] = useState(false);
  const [proposal, setProposal] = useState<ProposalView | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    return () => controller.abort();
  }, []);

  const text = prompt.trim();
  const canGenerate = text !== "" && text.length <= PROMPT_MAX && !isPending && !isDeciding;

  const generate = () => {
    if (!canGenerate) return;
    const controller = abortRef.current;
    setError(null);
    setPending(true);
    void (async () => {
      try {
        const response = await fetch("/api/ai/view", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ project_id: projectId, prompt: text, conversation_id: conversationId(conversation) }),
          cache: "no-store",
          signal: controller?.signal,
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          setError(messageOf(body, "Could not describe a view"));
          return;
        }
        const parsed = ProposalViewSchema.safeParse(body);
        if (!parsed.success) {
          setError("Could not describe a view");
          return;
        }
        setProposal(parsed.data);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError("Could not describe a view");
      } finally {
        if (!controller?.signal.aborted) setPending(false);
      }
    })();
  };

  const apply = () => {
    if (!proposal || isDeciding) return;
    setDeciding(true);
    setError(null);
    void (async () => {
      const result = await applyProposalsAction({
        ids: [proposal.id],
        confirmed_ids: proposal.destructive ? [proposal.id] : [],
      });
      setDeciding(false);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const outcome = result.data[0];
      if (!outcome) return;
      setProposal(withOutcome(proposal, outcome));
      if (outcome.status !== "applied") {
        if (outcome.error?.message) setError(outcome.error.message);
        return;
      }
      const viewId = viewIdOf(outcome.data);
      onOpenChange(false);
      if (viewId) router.push(`/projects/${projectId}/views/${viewId}`);
    })();
  };

  const discard = () => {
    if (!proposal || isDeciding) return;
    setDeciding(true);
    void (async () => {
      const result = await discardProposalsAction({ ids: [proposal.id] });
      setDeciding(false);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const next = result.data[0];
      if (next) setProposal(next);
    })();
  };

  const close = () => {
    if (!isPending && !isDeciding) onOpenChange(false);
  };

  return (
    <Layout
      header={<DialogHeader title="Describe a view" onOpenChange={close} hasDivider />}
      content={
        <LayoutContent>
          <VStack gap={4}>
            <TextArea
              label="Describe the view"
              rows={4}
              value={prompt}
              onChange={(value) => {
                setPrompt(value);
                if (error) setError(null);
              }}
              isRequired
              hasAutoFocus
              maxLength={PROMPT_MAX}
              placeholder="Open high-priority items assigned to me as a board"
              isDisabled={isPending || isDeciding}
              status={error ? { type: "error", message: error } : undefined}
            />
            {proposal ? <ProposalRow proposal={proposal} isBusy={isDeciding} onApply={apply} onDiscard={discard} /> : null}
          </VStack>
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          <HStack gap={3} hAlign="end">
            <Button variant="ghost" label="Cancel" onClick={close} isDisabled={isPending || isDeciding} />
            <Button variant="primary" label="Generate" onClick={generate} isLoading={isPending} isDisabled={!canGenerate} />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}

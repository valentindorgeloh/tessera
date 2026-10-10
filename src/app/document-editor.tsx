"use client";

import {useEffect, useState} from "react";
import {useRouter, useSearchParams} from "next/navigation";
import {FieldStatus} from "@astryxdesign/core/FieldStatus";
import {Heading} from "@astryxdesign/core/Text";
import {TextInput} from "@astryxdesign/core/TextInput";
import {VStack} from "@astryxdesign/core/Layout";
import {MilkdownProvider} from "@milkdown/react";
import type {WorkspaceNode} from "../lib/workspace-model";
import {updateNodeAction} from "./actions";
import {PageBody} from "./page-body";

export function DocumentEditor({
  node,
  onBodyChange,
}: {
  node: WorkspaceNode;
  onBodyChange?: (body: string) => void;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [title, setTitle] = useState(node.title);
  const [titleFocused, setTitleFocused] = useState(params.get("focus") === "title");
  const [body, setBody] = useState(node.body);
  const [error, setError] = useState<string | null>(null);

  const updateBody = (next: string) => {
    setBody(next);
    onBodyChange?.(next);
  };

  useEffect(() => {
    const nextTitle = title.trim();
    const nextBody = body.replace(/\s+$/, "");
    if (!nextTitle || (nextTitle === node.title && nextBody === node.body)) {
      return;
    }
    const handle = window.setTimeout(() => {
      void updateNodeAction(node.id, {
        title: nextTitle,
        summary: node.summary,
        body: nextBody,
      }).then((result) => {
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setError(null);
        router.refresh();
      });
    }, 500);
    return () => window.clearTimeout(handle);
  }, [body, node.body, node.id, node.summary, node.title, router, title]);

  return (
    <VStack gap={3}>
      <VStack className="handbook-title">
        {titleFocused ? (
          <TextInput
            label="Title"
            isLabelHidden
            value={title}
            onChange={setTitle}
            hasAutoFocus
            autoComplete="off"
            width="100%"
            onBlur={() => setTitleFocused(false)}
          />
        ) : (
          <Heading level={1} type="display-2" weight="semibold" onClick={() => setTitleFocused(true)}>
            {title.trim() || "Untitled"}
          </Heading>
        )}
      </VStack>
      <MilkdownProvider>
        <PageBody initial={node.body} onChange={updateBody} />
      </MilkdownProvider>
      {error ? (
        <FieldStatus variant="detached" type="error" message={error} />
      ) : null}
    </VStack>
  );
}

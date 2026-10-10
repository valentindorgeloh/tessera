"use client";

import {useRef, useState} from "react";
import {EmptyState} from "@astryxdesign/core/EmptyState";
import {Layout, LayoutContent, LayoutPanel} from "@astryxdesign/core/Layout";
import {Link} from "@astryxdesign/core/Link";
import type {WorkspaceNode} from "../lib/workspace-model";
import {findNode} from "../lib/workspace-model";
import {DocumentEditor} from "./document-editor";
import {PAGE_FRAME_WIDTH, PageColumn} from "./page-column";
import {PageOutline, outlineItems} from "./page-outline";
import {useWorkspace} from "./workspace-shell";
import {WorkspaceScreen} from "./workspace-screen";

export function ItemScreen({id}: {id: string}) {
  const nodes = useWorkspace();
  const node = findNode(nodes, id);

  if (!node) {
    return (
      <Layout
        padding={6}
        content={
          <LayoutContent>
            <EmptyState
              title="Page not found"
              description="This page is not in the handbook."
              actions={<Link href="/">Back to the handbook</Link>}
            />
          </LayoutContent>
        }
      />
    );
  }

  if (node.kind === "collection") {
    return <WorkspaceScreen parentId={node.id} />;
  }

  return <ItemPage key={node.id} node={node} />;
}

function ItemPage({node}: {node: WorkspaceNode}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [draftBody, setDraftBody] = useState(node.body);
  const showOutline = outlineItems(draftBody).length >= 2;

  return (
    <Layout
      height="fill"
      contentWidth={PAGE_FRAME_WIDTH}
      content={
        <LayoutContent ref={contentRef} padding={0}>
          <PageColumn>
            <DocumentEditor node={node} onBodyChange={setDraftBody} />
          </PageColumn>
        </LayoutContent>
      }
      end={
        showOutline ? (
          <LayoutPanel width={240} padding={4} hasDivider label="On this page">
            <PageOutline body={draftBody} scrollContainerRef={contentRef} />
          </LayoutPanel>
        ) : undefined
      }
    />
  );
}

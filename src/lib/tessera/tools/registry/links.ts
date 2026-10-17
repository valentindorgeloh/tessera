import { addLink, AddLinkInput, removeLink, updateLink, UpdateLinkInput } from "../../links";
import { defineTool } from "../define";
import { LinkId, LinkIdInput, removed } from "./shared";

// ---------------------------------------------------------------------------
// Links (P1: the service shipped with the work items, so the tools do)
// ---------------------------------------------------------------------------

export const linkTools = [
  defineTool({
    name: "add_link",
    title: "Add link",
    description: "Attaches an absolute http(s) URL to exactly one work item or module (one of work_item_id and module_id). The parent and its project must not be archived.",
    input: AddLinkInput,
    mutates: true,
    phase: "P1",
    run: (ctx, input) => addLink(ctx, input),
  }),
  defineTool({
    name: "update_link",
    title: "Update link",
    description: "Changes a link's title, URL or metadata (null metadata clears it); the parent must not be archived.",
    input: UpdateLinkInput.extend({ link_id: LinkId }),
    mutates: true,
    phase: "P1",
    run: (ctx, { link_id, ...patch }) => updateLink(ctx, link_id, patch),
  }),
  defineTool({
    name: "remove_link",
    title: "Remove link",
    description: "Removes a link from its work item or module; the parent must not be archived.",
    input: LinkIdInput,
    mutates: true,
    phase: "P1",
    run: (ctx, { link_id }) => {
      removeLink(ctx, link_id);
      return removed(link_id);
    },
  }),
];

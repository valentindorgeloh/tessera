/** Module links (moved verbatim from modules.ts): thin wrappers over links.ts that only accept module links. */
import type { TesseraContext } from "./core/context";
import { notFound, validateInput } from "./core/errors";
import { withTx } from "./core/tx";
import { addLink, getLink, LinkFieldsInput, removeLink, UpdateLinkInput, updateLink, type Link, type LinkFieldsInputType, type UpdateLinkInputType } from "./links";

export const AddModuleLinkInput = LinkFieldsInput;
export type AddModuleLinkInputType = LinkFieldsInputType;
export const UpdateModuleLinkInput = UpdateLinkInput;
export type UpdateModuleLinkInputType = UpdateLinkInputType;

/** The link must exist and belong to a module; a work item link is NOT_FOUND here. */
function assertModuleLink(ctx: TesseraContext, linkId: string): void {
  const link = getLink(ctx, linkId);
  if (link.parent_type !== "module") throw notFound("module_link", linkId);
}

export function addModuleLink(ctx: TesseraContext, moduleId: string, input: AddModuleLinkInputType): Link {
  const data = validateInput(AddModuleLinkInput, input);
  return addLink(ctx, { ...data, module_id: moduleId });
}

export function updateModuleLink(ctx: TesseraContext, linkId: string, patch: UpdateModuleLinkInputType): Link {
  return withTx(ctx, () => {
    assertModuleLink(ctx, linkId);
    return updateLink(ctx, linkId, patch);
  });
}

export function removeModuleLink(ctx: TesseraContext, linkId: string): void {
  withTx(ctx, () => {
    assertModuleLink(ctx, linkId);
    removeLink(ctx, linkId);
  });
}

/** Public surface of the description editor (docs/contracts/editor.md). */
export { MarkdownEditor, ENTITY_LINK_SCHEMES } from "./MarkdownEditor";
export type { EditorMode, EntityLink, EntityLinkScheme, MarkdownEditorHandle, MarkdownEditorProps } from "./MarkdownEditor";
export { entityHref, entityRoute, isAllowedEditorUri, parseEntityHref } from "./links";
export { editorExtensions, readSuggestionContext, setSuggestionContext } from "./extensions";
export type { EditorExtensionOptions, EditorSuggestions, SuggestionContext, SuggestionRow } from "./extensions";
export { buildEditorSuggestions } from "./mentions";
export { DESCRIPTION_SAVE_DELAY_MS, useDescriptionSave } from "./useDescriptionSave";
export type { DescriptionSaveState, DescriptionSaveStatus, UseDescriptionSaveInput, UseDescriptionSaveResult } from "./useDescriptionSave";

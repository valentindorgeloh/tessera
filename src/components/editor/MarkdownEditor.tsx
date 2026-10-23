"use client";

/**
 * Markdown description editor (docs/contracts/editor.md, "MarkdownEditor
 * interface"): Tiptap with the Markdown extension, a bubble menu for inline
 * marks and links, a drag handle, suggestion popovers, a source toggle and,
 * outside the compact peek, table controls (insert and delete rows and
 * columns, delete the table) while the selection is in a table.
 * The host owns saving through `useDescriptionSave`; this component reports
 * every document change through `onChange` and never saves itself.
 *
 * External value rule: the editor is keyed by the work item id by its host
 * and never remounts; a new `value` prop is applied only while the editor
 * holds no local edits and is not focused, otherwise the host decides.
 */
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import type { Editor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import {
  CodeIcon,
  ColumnAddLeftIcon,
  ColumnAddRightIcon,
  DragHandleIcon,
  FileCodeIcon,
  LinkSimpleIcon,
  RowAddAboveIcon,
  RowAddBelowIcon,
  TextBoldIcon,
  TextItalicIcon,
  TextStrikethroughIcon,
} from "@/themes/catppuccin/icons";
import { editorExtensions, setSuggestionContext } from "./extensions";
import { ENTITY_LINK_SCHEMES, isAllowedEditorUri, parseEntityHref, type EntityLink, type EntityLinkScheme } from "./links";
import { buildEditorSuggestions, isSuggestionActive } from "./mentions";

export { ENTITY_LINK_SCHEMES };
export type { EntityLink, EntityLinkScheme };

export type EditorMode = "rich" | "source";

export type MarkdownEditorHandle = {
  /** Current document as Markdown (editor.getMarkdown(); the textarea text in source mode). */
  getMarkdown(): string;
  /** Replaces the document without firing onChange; used by "Load theirs" and the source toggle. */
  setMarkdown(markdown: string): void;
  /** True while the editor holds edits that onChange has reported but no later setMarkdown/value accepted. */
  hasLocalEdits(): boolean;
  isFocused(): boolean;
  focus(): void;
  setMode(mode: EditorMode): void;
};

export type MarkdownEditorProps = {
  /** Markdown the host currently holds (server value after every refresh). */
  value: string;
  /** Fires on every user-originated change that moved the document (transaction.docChanged), not debounced. */
  onChange: (markdown: string) => void;
  /** Blur, mod+s, Escape inside the editor: the host saves right away. */
  onFlush?: () => void;
  /** Called once after mount when parse→serialise changed the text; `serialised` is what a save would store. */
  onLossyParse?: (serialised: string) => void;
  readOnly?: boolean;
  /** Peek: no drag handle, tighter padding, no table controls. */
  compact?: boolean;
  placeholder?: string;
  /** Default ENTITY_LINK_SCHEMES. */
  linkSchemes?: readonly string[];
  /** `@` candidates (ProjectBundle.actors mapped to id + name). */
  mentionActors?: readonly { id: string; name: string }[];
  /** Scope of the `#` search (GET /api/search?scope=); null outside a project. */
  projectId?: string | null;
  /** Click on an entity link or chip; the host navigates (work → ?peek / page). */
  onOpenEntity?: (link: EntityLink) => void;
  ref?: Ref<MarkdownEditorHandle>;
};

const DEFAULT_PLACEHOLDER = "Add context, links or acceptance criteria. Type / for blocks, # for work items, @ for people.";
const NO_ACTORS: readonly { id: string; name: string }[] = [];

/** Trailing newlines carry no meaning; the lossy check ignores them. */
function normalise(markdown: string): string {
  return markdown.replace(/\n+$/, "");
}

function isMod(event: KeyboardEvent | React.KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

function classes(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

type Callbacks = Pick<MarkdownEditorProps, "onChange" | "onFlush" | "onLossyParse" | "onOpenEntity">;

export function MarkdownEditor({
  value,
  onChange,
  onFlush,
  onLossyParse,
  readOnly = false,
  compact = false,
  placeholder = DEFAULT_PLACEHOLDER,
  linkSchemes = ENTITY_LINK_SCHEMES,
  mentionActors = NO_ACTORS,
  projectId = null,
  onOpenEntity,
  ref,
}: MarkdownEditorProps) {
  const [mode, setModeState] = useState<EditorMode>("rich");
  const [sourceText, setSourceText] = useState(value);
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  /** The hovered block's heading level ("h1".."h3"), "" for any other block: the drag handle centres on the block's first line (editor.css). */
  const [handleBlock, setHandleBlock] = useState("");
  const onHandleNode = useCallback(({ node }: { node: { type: { name: string }; attrs: Record<string, unknown> } | null }) => {
    const level = node?.type.name === "heading" ? Number(node.attrs.level) : 0;
    setHandleBlock(level >= 1 && level <= 3 ? `h${level}` : "");
  }, []);

  // Callbacks the editor's one-time option closures read; synced after every render.
  const callbacks = useRef<Callbacks>({ onChange, onFlush, onLossyParse, onOpenEntity });
  useEffect(() => {
    callbacks.current = { onChange, onFlush, onLossyParse, onOpenEntity };
  });

  const editorRef = useRef<Editor | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const modeRef = useRef<EditorMode>("rich");
  const sourceTextRef = useRef(value);
  /** Last Markdown reported through onChange (or accepted from outside). */
  const lastReported = useRef(value);
  /** Last Markdown accepted from the host (prop value or setMarkdown). */
  const lastAccepted = useRef(value);
  /** Reported edits not yet matched by an accepted value. */
  const dirty = useRef(false);
  const initialValue = useRef(value);

  // Built once: the editor is never recreated, so later compact/placeholder/linkSchemes changes do not apply
  // (the host keys the editor by work item). The triggers read actors and scope from the editor's storage.
  const [extensions] = useState(() => editorExtensions({ compact, placeholder, linkSchemes, mentions: buildEditorSuggestions() }));

  const report = useCallback((markdown: string) => {
    if (markdown === lastReported.current) return;
    lastReported.current = markdown;
    dirty.current = true;
    callbacks.current.onChange(markdown);
  }, []);

  const flush = useCallback(() => {
    callbacks.current.onFlush?.();
  }, []);

  const setMode = useCallback(
    (next: EditorMode) => {
      if (next === modeRef.current) return;
      const editor = editorRef.current;
      if (next === "source") {
        const markdown = editor ? editor.getMarkdown() : lastReported.current;
        sourceTextRef.current = markdown;
        setSourceText(markdown);
        modeRef.current = "source";
        setModeState("source");
        return;
      }
      modeRef.current = "rich";
      setModeState("rich");
      if (editor) {
        // Default emitUpdate: the update handler reports the normalised text when it differs.
        editor.commands.setContent(sourceTextRef.current, { contentType: "markdown" });
      }
    },
    [],
  );

  const toggleMode = useCallback(() => setMode(modeRef.current === "rich" ? "source" : "rich"), [setMode]);

  const handleEntityClick = useCallback((event: MouseEvent): boolean => {
    const target = event.target instanceof Element ? event.target : null;
    const anchor = target?.closest("a[href]");
    const href = anchor?.getAttribute("href");
    if (!href) return false;
    const link = parseEntityHref(href);
    if (link) {
      event.preventDefault();
      callbacks.current.onOpenEntity?.(link);
      return true;
    }
    if (isMod(event as unknown as KeyboardEvent) && /^https?:/i.test(href)) {
      event.preventDefault();
      window.open(href, "_blank", "noopener,noreferrer");
      return true;
    }
    return false;
  }, []);

  const handleEditorKeyDown = useCallback(
    (view: EditorView, event: KeyboardEvent): boolean => {
      if (event.key === "Escape") {
        // An open suggestion popover takes Escape first (mentions.tsx closes it).
        if (isSuggestionActive(view.state)) return false;
        editorRef.current?.commands.blur();
        flush();
        event.stopPropagation();
        return true;
      }
      if (isMod(event) && !event.altKey && event.key.toLowerCase() === "s" && !event.shiftKey) {
        event.preventDefault();
        flush();
        return true;
      }
      if (isMod(event) && event.shiftKey && event.key.toLowerCase() === "m") {
        event.preventDefault();
        toggleMode();
        return true;
      }
      return false;
    },
    [flush, toggleMode],
  );

  const editor = useEditor(
    {
      immediatelyRender: false, // no SSR render → no hydration mismatch
      shouldRerenderOnTransaction: false, // toolbar state through useEditorState()
      extensions,
      content: value,
      contentType: "markdown",
      editable: !readOnly,
      editorProps: {
        attributes: { class: "tessera-editor-content" },
        handleClick: (_view, _pos, event) => handleEntityClick(event),
        handleKeyDown: (view, event) => handleEditorKeyDown(view, event),
      },
      onCreate: ({ editor: created }) => {
        const out = created.getMarkdown();
        if (normalise(out) !== normalise(initialValue.current)) callbacks.current.onLossyParse?.(out);
      },
      onUpdate: ({ editor: updated, transaction }) => {
        if (!transaction.docChanged) return;
        report(updated.getMarkdown());
      },
      onBlur: () => flush(),
    },
    [], // never recreate; readOnly changes go through editor.setEditable
  );

  useEffect(() => {
    editorRef.current = editor;
    if (!editor) return;
    // setMarkdown may have run before the editor existed.
    if (lastAccepted.current !== initialValue.current) {
      editor.commands.setContent(lastAccepted.current, { contentType: "markdown", emitUpdate: false });
    }
  }, [editor]);

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  // The bubble menu plugin makes its root a tab stop (tabIndex 0) every time its view is rebuilt, and other plugins
  // registering (the drag handle, suggestions) rebuild it. The buttons inside are the stops, so the root stays
  // click-focusable only: put it back to -1 whenever the attribute changes.
  useEffect(() => {
    const root = bubbleRef.current;
    if (root === null) return;
    const settle = () => {
      if (root.tabIndex !== -1) root.tabIndex = -1;
    };
    settle();
    const observer = new MutationObserver(settle);
    observer.observe(root, { attributes: true, attributeFilter: ["tabindex"] });
    return () => observer.disconnect();
  }, [editor, mode]);

  // `@` candidates and the `#` search scope, read by the triggers at query time.
  useEffect(() => {
    if (editor) setSuggestionContext(editor, { actors: mentionActors, projectId });
  }, [editor, mentionActors, projectId]);

  const isSourceFocused = useCallback(() => {
    const el = sourceRef.current;
    return el !== null && typeof document !== "undefined" && document.activeElement === el;
  }, []);

  // External value rule.
  useEffect(() => {
    if (value === lastReported.current) {
      lastAccepted.current = value;
      dirty.current = false;
      return;
    }
    if (value === lastAccepted.current) return;
    if (dirty.current || editor?.isFocused || isSourceFocused()) return;
    editor?.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
    lastAccepted.current = value;
    lastReported.current = value;
    dirty.current = false;
    if (modeRef.current === "source") {
      sourceTextRef.current = value;
      setSourceText(value);
    }
  }, [editor, isSourceFocused, value]);

  // Source mode: focus the textarea and give it the same shortcuts as the rich editor.
  useEffect(() => {
    if (mode !== "source") return;
    const el = sourceRef.current;
    if (!el) return;
    el.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        el.blur();
        flush();
        event.stopPropagation();
        return;
      }
      if (isMod(event) && !event.altKey && event.key.toLowerCase() === "s" && !event.shiftKey) {
        event.preventDefault();
        flush();
        return;
      }
      if (isMod(event) && event.shiftKey && event.key.toLowerCase() === "m") {
        event.preventDefault();
        toggleMode();
      }
    };
    el.addEventListener("keydown", onKeyDown);
    return () => el.removeEventListener("keydown", onKeyDown);
  }, [mode, flush, toggleMode]);

  useImperativeHandle(
    ref,
    () => ({
      getMarkdown: () => (modeRef.current === "source" ? sourceTextRef.current : (editorRef.current?.getMarkdown() ?? lastReported.current)),
      setMarkdown: (markdown) => {
        editorRef.current?.commands.setContent(markdown, { contentType: "markdown", emitUpdate: false });
        lastAccepted.current = markdown;
        lastReported.current = markdown;
        dirty.current = false;
        if (modeRef.current === "source") {
          sourceTextRef.current = markdown;
          setSourceText(markdown);
        }
      },
      hasLocalEdits: () => dirty.current,
      isFocused: () => (modeRef.current === "source" ? isSourceFocused() : (editorRef.current?.isFocused ?? false)),
      focus: () => {
        if (modeRef.current === "source") sourceRef.current?.focus();
        else editorRef.current?.commands.focus();
      },
      setMode,
    }),
    [isSourceFocused, setMode],
  );

  const marks = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current
        ? {
            bold: current.isActive("bold"),
            italic: current.isActive("italic"),
            strike: current.isActive("strike"),
            code: current.isActive("code"),
            link: current.isActive("link"),
            href: (current.getAttributes("link").href as string | undefined) ?? "",
            table: current.isActive("table"),
          }
        : null,
  });

  const applyLink = () => {
    if (!editor || linkDraft === null) return;
    const raw = linkDraft.trim();
    setLinkDraft(null);
    if (raw === "") {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const href = isAllowedEditorUri(raw, linkSchemes) || /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
    if (!isAllowedEditorUri(href, linkSchemes)) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  };

  // Table controls: full width only (the compact peek has none), shown while the selection is in a table.
  const showTableControls = editor !== null && !compact && !readOnly && mode === "rich" && (marks?.table ?? false);
  const keepEditorFocus = (event: React.MouseEvent) => event.preventDefault();

  const onSourceChange = (text: string) => {
    sourceTextRef.current = text;
    setSourceText(text);
    report(text);
  };

  return (
    <VStack
      className={classes("tessera-editor", compact && "tessera-editor--compact", mode === "source" && "tessera-editor--source", readOnly && "tessera-editor--readonly")}
      gap={1}
      data-mode={mode}
    >
      <HStack className="tessera-editor-toolbar" hAlign="end" vAlign="center" gap={1}>
        {showTableControls && editor ? (
          <HStack className="tessera-editor-table-controls" gap={0.5} vAlign="center" role="toolbar" aria-label="Table">
            {/* Mousedown keeps the focus and the selection in the table the commands act on. */}
            <HStack gap={0.5} vAlign="center" onMouseDown={keepEditorFocus}>
              <IconButton variant="ghost" size="sm" label="Insert row above" icon={<Icon icon={RowAddAboveIcon} size="sm" />} onClick={() => editor.chain().focus().addRowBefore().run()} />
              <IconButton variant="ghost" size="sm" label="Insert row below" icon={<Icon icon={RowAddBelowIcon} size="sm" />} onClick={() => editor.chain().focus().addRowAfter().run()} />
              <IconButton
                variant="ghost"
                size="sm"
                label="Insert column left"
                icon={<Icon icon={ColumnAddLeftIcon} size="sm" />}
                onClick={() => editor.chain().focus().addColumnBefore().run()}
              />
              <IconButton
                variant="ghost"
                size="sm"
                label="Insert column right"
                icon={<Icon icon={ColumnAddRightIcon} size="sm" />}
                onClick={() => editor.chain().focus().addColumnAfter().run()}
              />
            </HStack>
            <MoreMenu
              label="More table actions"
              size="sm"
              items={[
                { id: "delete-row", label: "Delete row", onClick: () => editor.chain().focus().deleteRow().run() },
                { id: "delete-column", label: "Delete column", onClick: () => editor.chain().focus().deleteColumn().run() },
                { type: "divider" },
                { id: "delete-table", label: "Delete table", variant: "destructive", onClick: () => editor.chain().focus().deleteTable().run() },
              ]}
            />
          </HStack>
        ) : null}
        <ToggleButton
          size="sm"
          label="Source"
          tooltip={mode === "source" ? "Back to rich text" : "Edit the Markdown source"}
          icon={<Icon icon={FileCodeIcon} size="sm" />}
          isPressed={mode === "source"}
          onPressedChange={(pressed) => setMode(pressed ? "source" : "rich")}
          isDisabled={readOnly && mode === "source"}
        />
      </HStack>
      <EditorContent editor={editor} className="tessera-editor-surface" />
      {mode === "source" ? (
        <TextArea
          ref={sourceRef}
          label="Markdown source"
          isLabelHidden
          value={sourceText}
          onChange={onSourceChange}
          onBlur={flush}
          rows={compact ? 10 : 16}
          isReadOnly={readOnly}
          hasSpellCheck={false}
          className="tessera-editor-source"
        />
      ) : null}
      {editor && mode === "rich" ? (
        <BubbleMenu
          editor={editor}
          className="tessera-editor-bubble"
          ref={bubbleRef}
          shouldShow={({ editor: current, from, to }) => from !== to && !current.isActive("codeBlock")}
          options={{ placement: "top" }}
        >
          <VStack gap={1}>
            {/* Mousedown on the mark buttons keeps the selection; the link input below must take focus and clicks. */}
            <HStack gap={0.5} vAlign="center" onMouseDown={keepEditorFocus}>
              <IconButton
                variant={marks?.bold ? "secondary" : "ghost"}
                size="sm"
                label="Bold"
                icon={<Icon icon={TextBoldIcon} size="sm" />}
                onClick={() => editor.chain().focus().toggleBold().run()}
              />
              <IconButton
                variant={marks?.italic ? "secondary" : "ghost"}
                size="sm"
                label="Italic"
                icon={<Icon icon={TextItalicIcon} size="sm" />}
                onClick={() => editor.chain().focus().toggleItalic().run()}
              />
              <IconButton
                variant={marks?.strike ? "secondary" : "ghost"}
                size="sm"
                label="Strikethrough"
                icon={<Icon icon={TextStrikethroughIcon} size="sm" />}
                onClick={() => editor.chain().focus().toggleStrike().run()}
              />
              <IconButton
                variant={marks?.code ? "secondary" : "ghost"}
                size="sm"
                label="Inline code"
                icon={<Icon icon={CodeIcon} size="sm" />}
                onClick={() => editor.chain().focus().toggleCode().run()}
              />
              <IconButton
                variant={marks?.link ? "secondary" : "ghost"}
                size="sm"
                label={marks?.link ? "Edit link" : "Add link"}
                icon={<Icon icon={LinkSimpleIcon} size="sm" />}
                onClick={() => setLinkDraft((draft) => (draft === null ? (marks?.href ?? "") : null))}
              />
            </HStack>
            {linkDraft !== null ? (
              <TextInput
                label="Link URL (empty removes the link)"
                isLabelHidden
                size="sm"
                value={linkDraft}
                onChange={setLinkDraft}
                onEnter={applyLink}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    setLinkDraft(null);
                  }
                }}
                placeholder="https://… or work:WEB-12"
                hasAutoFocus
                className="tessera-editor-link-input"
              />
            ) : null}
          </VStack>
        </BubbleMenu>
      ) : null}
      {editor && !compact && mode === "rich" && !readOnly ? (
        <DragHandle editor={editor} className={handleBlock === "" ? "tessera-editor-drag" : `tessera-editor-drag tessera-editor-drag--${handleBlock}`} onNodeChange={onHandleNode}>
          <Icon icon={DragHandleIcon} size="sm" color="secondary" />
        </DragHandle>
      ) : null}
    </VStack>
  );
}

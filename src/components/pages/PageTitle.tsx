"use client";

/**
 * The page name (docs/drafts/p6-plan.md "PageTitle"): the DetailTitle pattern.
 * A heading until it is clicked, then a large input that saves on blur or
 * Enter. Locked and archived pages stay a heading.
 */
import { useState } from "react";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack } from "@astryxdesign/core/Stack";
import { TextInput } from "@astryxdesign/core/TextInput";
import { PencilIcon } from "@/themes/catppuccin/icons";

export type PageTitleProps = {
  name: string;
  readOnly: boolean;
  onRename: (name: string) => void;
};

export function PageTitle({ name, readOnly, onRename }: PageTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  const start = () => {
    if (readOnly) return;
    setDraft(name);
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed === "" || trimmed === name) return;
    onRename(trimmed);
  };

  if (editing) {
    return (
      <TextInput
        label="Title"
        isLabelHidden
        size="lg"
        value={draft}
        onChange={setDraft}
        onBlur={commit}
        onEnter={commit}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setDraft(name);
            setEditing(false);
          }
        }}
        hasAutoFocus
        className="tessera-page-title-input"
      />
    );
  }

  return (
    <HStack gap={1} vAlign="start" className="tessera-page-title-row">
      <Heading level={1} className={readOnly ? "tessera-page-title tessera-page-title--readonly" : "tessera-page-title"} onClick={start}>
        {name}
      </Heading>
      {readOnly ? null : (
        <IconButton variant="ghost" size="sm" label="Edit title" icon={<Icon icon={PencilIcon} size="sm" />} onClick={start} className="tessera-page-title-edit" />
      )}
    </HStack>
  );
}

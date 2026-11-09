"use client";

import { Kbd } from "@astryxdesign/core/Kbd";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Dialog, DialogHeader } from "@/components/shell/dialogs";
import { shortcutHint } from "./command-source";
import { SHORTCUTS, type ShortcutGroup } from "./shortcuts";
import { setSingleKeys } from "./useShortcuts";

/** Kbd for `mod+delete` shows the Backspace glyph, the key most keyboards label Delete. */
function kbdKeys(step: string): string {
  return step.replace("delete", "backspace");
}

export function ShortcutKeys({ keys }: { keys: string }) {
  const steps = keys.split(" ");
  return (
    <HStack gap={1} vAlign="center" className="tessera-cmd-keys">
      {steps.map((step, index) => (
        <HStack key={step} gap={1} vAlign="center">
          {index > 0 ? (
            <Text type="supporting" color="secondary">
              then
            </Text>
          ) : null}
          <Kbd keys={kbdKeys(step)} />
        </HStack>
      ))}
    </HStack>
  );
}

// ---------------------------------------------------------------------------
// Help dialog (mod+/)
// ---------------------------------------------------------------------------

const GROUP_ORDER: readonly ShortcutGroup[] = ["Global", "Work item", "Create", "Navigate"];

export function ShortcutsDialog({ isOpen, onOpenChange, singleKeys }: { isOpen: boolean; onOpenChange: (isOpen: boolean) => void; singleKeys: boolean }) {
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} width={560} maxHeight="85dvh" purpose="info">
      <Layout
        header={<DialogHeader title="Keyboard shortcuts" onOpenChange={onOpenChange} hasDivider />}
        content={
          <LayoutContent isScrollable>
            <VStack gap={5}>
              <Switch
                label="Single-key shortcuts"
                description="Letters such as s and p, and the g and n chords. Turn them off if they get in the way of speech input."
                value={singleKeys}
                onChange={(checked) => setSingleKeys(checked)}
              />
              {GROUP_ORDER.map((group) => (
                <VStack key={group} gap={2}>
                  <Heading level={3}>{group}</Heading>
                  <List density="compact">
                    {SHORTCUTS.filter((def) => def.group === group).map((def) => (
                      <ListItem
                        key={def.id}
                        label={def.label}
                        description={shortcutHint(def)}
                        endContent={<ShortcutKeys keys={def.keys} />}
                      />
                    ))}
                  </List>
                </VStack>
              ))}
            </VStack>
          </LayoutContent>
        }
      />
    </Dialog>
  );
}

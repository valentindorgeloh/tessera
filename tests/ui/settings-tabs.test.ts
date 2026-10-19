/**
 * Tabs of the project settings (src/components/project-settings/settings-tabs.ts):
 * the settings tabs in order and the active one from the path.
 */
import { describe, expect, it } from "vitest";
import { SETTINGS_TABS, activeSettingsTab } from "@/components/project-settings/settings-tabs";

const PROJECT = "11111111-1111-7111-8111-111111111111";
const OTHER = "22222222-2222-7222-8222-222222222222";

describe("SETTINGS_TABS", () => {
  it("lists General, Features, States, Labels, Estimates, Agents and Automations in order", () => {
    expect(SETTINGS_TABS).toEqual([
      { key: "general", label: "General" },
      { key: "features", label: "Features" },
      { key: "states", label: "States" },
      { key: "labels", label: "Labels" },
      { key: "estimates", label: "Estimates" },
      { key: "agents", label: "Agents" },
      { key: "automations", label: "Automations" },
    ]);
  });
});

describe("activeSettingsTab", () => {
  it("reads the segment after /settings/", () => {
    for (const tab of SETTINGS_TABS) {
      expect(activeSettingsTab(`/projects/${PROJECT}/settings/${tab.key}`, PROJECT)).toBe(tab.key);
    }
  });

  it("ignores a trailing path", () => {
    expect(activeSettingsTab(`/projects/${PROJECT}/settings/states/x`, PROJECT)).toBe("states");
  });

  it("is null for the bare settings path, another project, another area or an unknown tab", () => {
    expect(activeSettingsTab(`/projects/${PROJECT}/settings`, PROJECT)).toBeNull();
    expect(activeSettingsTab(`/projects/${PROJECT}/settings/`, PROJECT)).toBeNull();
    expect(activeSettingsTab(`/projects/${OTHER}/settings/general`, PROJECT)).toBeNull();
    expect(activeSettingsTab(`/projects/${PROJECT}/archives/general`, PROJECT)).toBeNull();
    expect(activeSettingsTab(`/projects/${PROJECT}/settings/billing`, PROJECT)).toBeNull();
  });
});

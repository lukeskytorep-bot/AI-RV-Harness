import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { getCopy } from "../../i18n";
import { createDefaultSettings } from "../../startupDefaults";
import { PROJECT_CREDITS_URL } from "./CreditsCard";
import { SettingsScreen, type SettingsScreenProps } from "./SettingsScreen";

function makeProps(overrides: Partial<SettingsScreenProps> = {}): SettingsScreenProps {
  return {
    copy: getCopy("en"),
    settings: createDefaultSettings(),
    workspaces: [],
    repository: null,
    onDataChanged: vi.fn(async () => undefined),
    onChange: vi.fn(),
    ...overrides,
  };
}

describe("SettingsScreen", () => {
  it("renders the Settings feature without repository access", () => {
    const props = makeProps();
    const html = renderToStaticMarkup(<SettingsScreen {...props} />);

    expect(html).toContain(props.copy.settings);
    expect(html).toContain(props.copy.providersApi.replace("&", "&amp;"));
    expect(html).toContain(props.copy.models);
    expect(html).toContain(props.copy.storage);
    expect(html).toContain(props.copy.appearance);
  });

  it("does not mutate application-owned settings while rendering", () => {
    const onChange = vi.fn();
    renderToStaticMarkup(<SettingsScreen {...makeProps({ onChange })} />);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("uses the canonical GitHub page for complete project credits", () => {
    expect(PROJECT_CREDITS_URL).toBe("https://github.com/lukeskytorep-bot/AI-RV-Harness/blob/main/CREDITS.md");
  });
});

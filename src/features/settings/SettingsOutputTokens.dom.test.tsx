// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { getCopy } from "../../i18n";
import { createDefaultSettings } from "../../startupDefaults";
import type { AppSettings } from "../../types";
import { SettingsScreen } from "./SettingsScreen";

vi.mock("../../components/ProviderSettings", () => ({ ProviderSettings: () => null }));

it("Settings commits Conversation and RV Sessions only at or above the 16K floor while allowing normal multi-digit editing", async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const copy = getCopy("en");
  const changes = vi.fn();
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  function Harness() {
    const [settings, setSettings] = useState<AppSettings>(createDefaultSettings());
    return <SettingsScreen copy={copy} settings={settings} workspaces={[]} repository={null} onDataChanged={async () => undefined} onChange={(patch) => { changes(patch); setSettings((current) => ({ ...current, ...patch })); }} />;
  }
  const setNativeValue = (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const byLabel = (label: string) => [...host.querySelectorAll("label")].find((node) => node.querySelector("span")?.textContent === label)?.querySelector("input") as HTMLInputElement;
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>(".settings-tabs button")].find((button) => button.textContent === copy.sessions)!.click());
    const conversation = byLabel(copy.conversationOutputTokens);
    const rv = byLabel(copy.rvSessionOutputTokens);
    expect(conversation.min).toBe("16384"); expect(rv.min).toBe("16384");

    changes.mockClear();
    await act(async () => { conversation.focus(); setNativeValue(conversation, "3"); setNativeValue(conversation, "32"); setNativeValue(conversation, "327"); setNativeValue(conversation, "32768"); });
    expect(changes).not.toHaveBeenCalled();
    await act(async () => conversation.blur());
    expect(changes).toHaveBeenLastCalledWith({ conversationMaxOutputTokens: 32768 });
    expect(byLabel(copy.conversationOutputTokens).value).toBe("32768");

    await act(async () => { const current = byLabel(copy.conversationOutputTokens); current.focus(); setNativeValue(current, "8192"); current.blur(); });
    expect(changes).toHaveBeenLastCalledWith({ conversationMaxOutputTokens: 16384 });
    expect(byLabel(copy.conversationOutputTokens).value).toBe("16384");

    await act(async () => { rv.focus(); setNativeValue(rv, "32768"); rv.blur(); });
    expect(changes).toHaveBeenLastCalledWith({ rvSessionMaxOutputTokens: 32768 });
    await act(async () => { const current = byLabel(copy.rvSessionOutputTokens); current.focus(); setNativeValue(current, "16383"); current.blur(); });
    expect(changes).toHaveBeenLastCalledWith({ rvSessionMaxOutputTokens: 16384 });
    expect(byLabel(copy.rvSessionOutputTokens).value).toBe("16384");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

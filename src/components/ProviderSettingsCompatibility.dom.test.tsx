// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { getCopy } from "../i18n";
import type { AppRepository } from "../storage/repository";
import type { ProviderConfig } from "../providers/types";
import { ProviderSettings } from "./ProviderSettings";
vi.mock("../storage", () => ({ isTauriRuntime: () => true }));
vi.mock("./AppDialogProvider", () => ({ useAppDialogs: () => ({}) }));

it.each(["pl", "en"] as const)("saves and reopens both compatibility choices for existing Custom only (%s)", async language => {
  const env = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }; const previous = env.IS_REACT_ACT_ENVIRONMENT; env.IS_REACT_ACT_ENVIRONMENT = true;
  const copy = getCopy(language);
  let custom: ProviderConfig = { id: "p", provider: "custom_openai", label: "Pod", credentialId: "key", baseUrl: "https://example.test/v1", enabled: true, createdAt: "t", updatedAt: "t", customStreamingEnabled: true, customOutputTokenField: "max_completion_tokens" };
  const repository = {
    listProviderConfigs: async () => [{ ...custom }, { ...custom, id: "other", provider: "openrouter" }], listProviderModels: async () => [],
    updateProviderCustomOutputTokenField: vi.fn(async () => undefined), updateProviderCustomStreamingEnabled: vi.fn(async () => undefined),
    updateProviderCustomCompatibilityProfile: vi.fn(async (_id, value) => { custom = { ...custom, customCompatibilityProfile: value }; }),
  } as unknown as AppRepository;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const open = async () => { await act(async () => host.querySelector<HTMLButtonElement>(`button[title="${copy.customWireSettings}"]`)!.click()); };
  try {
    await act(async () => root.render(<ProviderSettings copy={copy} repository={repository} language={language} section="providers" />));
    expect(host.querySelectorAll(`button[title="${copy.customWireSettings}"]`)).toHaveLength(1);
    await open();
    for (const value of ["llama_cpp", "generic"] as const) {
      const dialog = host.querySelector('[role="dialog"]')!;
      const select = [...dialog.querySelectorAll("select")].find(item => [...item.options].some(o => o.value === "llama_cpp"))!;
      expect(select.value).toBe(value === "llama_cpp" ? "generic" : "llama_cpp");
      expect(dialog.textContent).toContain(copy.customCompatibilityHelp);
      await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
      const form = select.closest("form")!;
      await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
      expect(repository.updateProviderCustomCompatibilityProfile).toHaveBeenLastCalledWith("p", value);
      expect(custom).toMatchObject({ credentialId: "key", baseUrl: "https://example.test/v1", customStreamingEnabled: true, customOutputTokenField: "max_completion_tokens" });
      await open();
      expect([...host.querySelectorAll('select')].find(item => [...item.options].some(o => o.value === "llama_cpp"))?.value).toBe(value);
    }
  } finally { await act(async () => root.unmount()); host.remove(); env.IS_REACT_ACT_ENVIRONMENT = previous; }
});

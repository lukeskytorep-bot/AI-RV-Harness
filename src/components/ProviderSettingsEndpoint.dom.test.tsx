// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { getCopy } from "../i18n";
import type { ProviderConfig } from "../providers/types";
import type { AppRepository } from "../storage/repository";
import { ProviderSettings } from "./ProviderSettings";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../storage", () => ({ isTauriRuntime: () => true }));

it("edits the Custom endpoint through native IPC and retains the separate key replacement action", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const copy = getCopy("pl");
  const oldUrl = "https://old.example/v1";
  const newUrl = "https://new.example/v1";
  const custom: ProviderConfig = {
    id: "custom", provider: "custom_openai", label: "RunPod", credentialId: "saved-key",
    baseUrl: oldUrl, enabled: true, createdAt: "now", updatedAt: "now",
    customOutputTokenField: "max_completion_tokens", customStreamingEnabled: true,
  };
  const other: ProviderConfig = { ...custom, id: "other", provider: "blackbox", label: "Other" };
  const repository = {
    listProviderConfigs: async () => [{ ...custom }, other],
    listProviderModels: async () => [],
    updateProviderCredentialMetadata: vi.fn(),
    replaceProviderModels: vi.fn(),
    updateProviderConnectionStatus: vi.fn(),
  } as unknown as AppRepository;
  const host = document.createElement("div");
  document.body.append(host);
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  const root = createRoot(host);
  const open = async () => {
    await act(async () => host.querySelector<HTMLButtonElement>(`button[title="${copy.customWireSettings}"]`)!.click());
    return host.querySelector<HTMLElement>("[role=dialog]")!;
  };
  const submit = async (form: HTMLFormElement) => {
    await act(async () => { form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true })); });
  };
  const setValue = async (field: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  try {
    await act(async () => root.render(<ProviderSettings copy={copy} repository={repository} section="providers" language="pl" />));
    expect(host.querySelectorAll(`button[title="${copy.customWireSettings}"]`)).toHaveLength(1);
    let dialog = await open();
    const url = dialog.querySelector<HTMLInputElement>("input[type=url]")!;
    expect(url.value).toBe(oldUrl);
    expect(dialog.querySelector("input[type=password]")).toBeNull();
    await setValue(url, newUrl);

    invoke.mockResolvedValueOnce(null);
    await submit(url.form!);
    expect(custom.baseUrl).toBe(oldUrl);
    expect(host.querySelector("[role=dialog]")).toBe(dialog);
    expect(invoke).toHaveBeenLastCalledWith("change_custom_openai_endpoint", {
      connectionId: "custom", credentialId: "saved-key", expectedEndpoint: oldUrl, destination: newUrl, language: "pl",
    });

    invoke.mockRejectedValueOnce("HTTP 401");
    await submit(url.form!);
    expect(dialog.querySelector("[role=alert]")?.textContent).toContain("HTTP 401");
    expect(custom.baseUrl).toBe(oldUrl);

    invoke.mockImplementationOnce(async () => {
      custom.baseUrl = newUrl;
      return { missingModelIds: ["model-before-move"] };
    });
    await submit(url.form!);
    expect(host.querySelector("[role=status]")?.textContent).toContain("model-before-move");
    expect(repository.replaceProviderModels).not.toHaveBeenCalled();
    dialog = await open();
    expect(dialog.querySelector<HTMLInputElement>("input[type=url]")?.value).toBe(newUrl);
    expect(dialog.querySelector<HTMLInputElement>("input[type=checkbox]")?.checked).toBe(true);
    expect(dialog.querySelector<HTMLSelectElement>("select")?.value).toBe("max_completion_tokens");

    await act(async () => dialog.querySelector<HTMLButtonElement>("button.icon-button")!.click());
    await act(async () => host.querySelector<HTMLButtonElement>(`button[title="${copy.apiKey}"]`)!.click());
    const key = host.querySelector<HTMLInputElement>("input[type=password]")!;
    expect(key).toBeTruthy();
    await setValue(key, "replacement-key");
    invoke.mockImplementation(async (command: string) => command === "has_credential" ? true :
      command === "provider_discover_models" ? { data: [] } : undefined);
    await submit(key.form!);
    expect(invoke).toHaveBeenCalledWith("rebind_credential", {
      credentialId: "saved-key", secret: "replacement-key", provider: "custom_openai", baseUrl: newUrl,
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  }
});

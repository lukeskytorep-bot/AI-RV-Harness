// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { NativeConnectionSettings } from "./NativeConnectionSettings";
import { freezeNativeConnection } from "../providers/nativeConnectionIdentity";
import { listNativeConnections, saveNativeConnection, discoverNativeConnection, type NativeConnectionView } from "../providers/nativeDiscovery";
vi.mock("../storage", () => ({ isTauriRuntime: () => true }));
vi.mock("../providers/nativeDiscovery", () => ({ listNativeConnections: vi.fn(), saveNativeConnection: vi.fn(), discoverNativeConnection: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const view: NativeConnectionView = { connection: { id: "native", provider: "ollama_native", label: "Saved native", baseUrl: "https://old.example", authMode: "bearer", credentialId: "bound", connectionIdentityId: "identity", connectionRevision: 1, enabled: false }, discovery: { binding: { version: 1, provider: "ollama_native", providerConfigId: "native", connectionIdentityId: "identity", connectionRevision: 1, normalizedEndpoint: "https://old.example", authMode: "bearer" }, serverVersion: "fixture", capturedAtMs: 100, models: [{ name: "exact:tag", digest: "sha256:fixture" }], selectedModel: "exact:tag", selectedAvailable: true, detailsUnavailable: false, generationAvailable: false } };
let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; vi.resetAllMocks(); });
async function mount(rows: NativeConnectionView[] = []) {
  vi.mocked(listNativeConnections).mockResolvedValue(rows);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  cleanup = async () => { await act(async () => root.unmount()); host.remove(); };
  await act(async () => root.render(<NativeConnectionSettings />));
  const click = async (text: string) => { await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === text)!.click()); };
  const submit = async () => { await act(async () => host.querySelector("[role=dialog] form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); };
  return { host, click, submit };
}
async function field(element: HTMLInputElement | HTMLSelectElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(element.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true })); }); }
it("creates Cloud with fixed official host and required Bearer key, without local installation", async () => {
  const { host, click, submit } = await mount(); await click("Add Ollama Cloud");
  const dialog=host.querySelector("[role=dialog]")!; const key=dialog.querySelector<HTMLInputElement>("input[type=password]")!;
  expect(key.required).toBe(true); expect(dialog.querySelector("select")).toBeNull(); expect(dialog.querySelector<HTMLInputElement>("input[type=url]")!.readOnly).toBe(true);
  expect(dialog.textContent).toContain("https://ollama.com"); expect(dialog.textContent).toContain("No text is generated"); expect(host.textContent).toContain("Generation is not available");
  await field(key,"fixture-secret");vi.mocked(saveNativeConnection).mockResolvedValue(view);await submit();
  expect(saveNativeConnection).toHaveBeenCalledWith({expected:undefined,label:"Ollama Cloud",baseUrl:"https://ollama.com",authMode:"bearer",apiKey:"fixture-secret",selectedModel:undefined});expect(discoverNativeConnection).not.toHaveBeenCalled();
});

it("edits the endpoint using the stored key, preserving exact model and expected binding", async () => {
  const { host, click, submit } = await mount([view]); await click("Edit connection"); const dialog = host.querySelector("[role=dialog]")!;
  expect(dialog.querySelector<HTMLInputElement>("input[type=password]")!.value).toBe(""); await field(dialog.querySelector("input[type=url]")!, "https://new.example/Proxy/"); expect(dialog.textContent).toContain("https://new.example/Proxy/"); expect(dialog.textContent).toContain("saved key to this address");
  vi.mocked(saveNativeConnection).mockResolvedValue(view); await submit(); expect(saveNativeConnection).toHaveBeenCalledWith(expect.objectContaining({ expected: freezeNativeConnection(view.connection), baseUrl: "https://new.example/Proxy", apiKey: undefined, selectedModel: "exact:tag" }));
});
it("failed discovery keeps the editor, old endpoint and selected model", async () => {
  const { host, click, submit } = await mount([view]); await click("Edit connection"); await field(host.querySelector("input[type=url]")!, "https://bad.example"); vi.mocked(saveNativeConnection).mockRejectedValue(new Error("private server message")); await submit();
  expect(host.querySelector("[role=dialog]")).not.toBeNull(); expect(host.textContent).toContain("https://old.example"); expect(host.textContent).not.toContain("private server message"); expect(host.textContent).toContain("exact:tag");
});
it("clears a typed key on explicit switch to None", async () => {
  const { host, click, submit } = await mount([view]); await click("Edit connection"); await field(host.querySelector("input[type=password]")!, "private-key"); await field(host.querySelector("[role=dialog] select")!, "none"); vi.mocked(saveNativeConnection).mockResolvedValue(view); await submit(); expect(saveNativeConnection).toHaveBeenCalledWith(expect.objectContaining({ authMode: "none", apiKey: undefined })); expect(host.textContent).not.toContain("private-key");
});
it("retains a missing exact model, shows provenance and refreshes only on an explicit action", async () => {
  const missing = { ...view, discovery: { ...view.discovery!, selectedModel: "missing:tag", selectedAvailable: false, detailsUnavailable: true } };
  const { host, click } = await mount([missing]); expect(host.textContent).toContain("missing:tag"); expect(host.textContent).toContain("identifier is retained"); expect(host.textContent).toContain("capabilities remain unknown"); expect(discoverNativeConnection).not.toHaveBeenCalled();
  vi.mocked(discoverNativeConnection).mockResolvedValue(missing.discovery); await click("Refresh discovery"); expect(discoverNativeConnection).toHaveBeenCalledWith(freezeNativeConnection(view.connection), "missing:tag");
});

it("shows hosted Cloud with unknown version and no mandatory digest or local version display", async () => {
  const cloud:NativeConnectionView={connection:{...view.connection,baseUrl:"https://ollama.com"},discovery:{...view.discovery!,binding:{...view.discovery!.binding,normalizedEndpoint:"https://ollama.com"},serverVersion:null,models:[{name:"gemma4:31b"}],selectedModel:"gemma4:31b",detailsUnavailable:true}};
  const {host,click,submit}=await mount([cloud]);expect(host.textContent).toContain("Hosted Ollama Cloud API");expect(host.textContent).not.toContain("Server version:");await click("Edit connection");expect(host.querySelector<HTMLInputElement>("input[type=password]")!.required).toBe(false);vi.mocked(saveNativeConnection).mockResolvedValue(cloud);await submit();expect(saveNativeConnection).toHaveBeenCalledWith(expect.objectContaining({baseUrl:"https://ollama.com",authMode:"bearer",apiKey:undefined,selectedModel:"gemma4:31b"}));
});

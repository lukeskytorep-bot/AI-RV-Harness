// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("./NativeConnectionSettings", () => ({ NativeConnectionSettings: () => null }));
vi.mock("../providers/cloudConformance", () => ({ runCloudConformance: vi.fn() }));
vi.mock("../storage/native", () => ({ saveTextFile: vi.fn() }));
import { runCloudConformance, type CloudConformanceReport } from "../providers/cloudConformance";
import { saveTextFile } from "../storage/native";
import { ProviderSettings } from "./ProviderSettings";
import { getCopy } from "../i18n";
import { CloudConformanceDialog } from "./CloudConformanceDialog";
import { normalizeModelDiscovery } from "../providers/capabilities";
import type { AppRepository } from "../storage/repository";
const config = { id: "c", provider: "ollama_cloud" as const, label: "Cloud", credentialId: "opaque", enabled: true, createdAt: "t", updatedAt: "t" };
const models = normalizeModelDiscovery(config, { models: [{ name: "exact:model" }] });
const repo = {} as AppRepository;
const report: CloudConformanceReport = { version: 1, test: "ollama_cloud_two_turn_v1", replyComparison: "trim_exact_v1", id: "id", startedAt: "t", providerConfigId: "c", endpoint: "https://ollama.com/api/chat", modelId: "exact:model", serverVersion: null, outcome: "two_turn_recall_observed", turns: [], fullInputPreservation: "unverified", oversizedRejection: "unverified", automaticGenerationEnabled: false };
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); vi.resetAllMocks(); });
async function mount(language: "pl" | "en" = "pl") {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  cleanup = async () => { await act(async () => root.unmount()); host.remove(); };
  await act(async () => root.render(<CloudConformanceDialog config={config} models={models} repository={repo} language={language} onClose={() => {}} />));
  const click = async (text: string) => act(async () => { [...host.querySelectorAll("button")].find(b => b.textContent === text)!.click(); });
  return { host, click };
}
it.each(["pl", "en"] as const)("%s warns before any call and exports a report without activating automatic modes", async language => {
  const { host, click } = await mount(language);
  expect(runCloudConformance).not.toHaveBeenCalled();
  expect(host.textContent).toContain("4096"); expect(host.textContent).toContain("https://ollama.com/api/chat");
  expect(host.textContent).toContain(language === "pl" ? "Mogą być płatne" : "may be billed");
  expect(host.textContent).toContain(language === "pl" ? "Tryby automatyczne pozostają zablokowane" : "Automatic modes remain blocked");
  vi.mocked(runCloudConformance).mockResolvedValue(report);
  await click(language === "pl" ? "Uruchom test (do 2 wywołań)" : "Run test (up to 2 calls)");
  expect(runCloudConformance).toHaveBeenCalledTimes(1);
  expect(vi.mocked(runCloudConformance).mock.calls[0][0]).toMatchObject({ providerConfigId: "c", modelId: "exact:model" });
  await click(language === "pl" ? "Zapisz raport JSON" : "Save JSON report");
  expect(saveTextFile).toHaveBeenCalledWith(expect.any(String), "ollama-cloud-conformance-id.json", JSON.stringify(report, null, 2));
});
it("uses one active test, exposes STOP and aborts its signal", async () => {
  let finish!: (r: CloudConformanceReport) => void;
  vi.mocked(runCloudConformance).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { host, click } = await mount();
  await click("Uruchom test (do 2 wywołań)");
  expect([...host.querySelectorAll("button")].find(b => b.textContent === "Zamknij")!.disabled).toBe(true);
  expect(host.querySelector("select")!.disabled).toBe(true);
  await click("STOP");
  const signal = vi.mocked(runCloudConformance).mock.calls[0][0].signal; expect(signal.aborted).toBe(true);
  await act(async () => finish({ ...report, outcome: "cancelled" }));
  expect(host.textContent).toContain("Test zatrzymany"); expect(runCloudConformance).toHaveBeenCalledTimes(1);
});
it("unmount cancels the active diagnostic", async () => {
  vi.mocked(runCloudConformance).mockImplementation(() => new Promise(() => {}));
  const { click } = await mount(); await click("Uruchom test (do 2 wywołań)");
  const signal = vi.mocked(runCloudConformance).mock.calls[0][0].signal;
  await cleanup!(); cleanup = undefined; expect(signal.aborted).toBe(true);
});

it("provider settings exposes the diagnostic only for hosted Ollama, without starting it", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  cleanup = async () => { await act(async () => root.unmount()); host.remove(); };
  const repository = { listProviderConfigs: async () => [config, { ...config, id: "custom", provider: "custom_openai" }], listProviderModels: async () => models } as unknown as AppRepository;
  await act(async () => root.render(<ProviderSettings copy={getCopy("pl")} repository={repository} section="providers" language="pl" />));
  expect([...host.querySelectorAll("button")].filter(b => b.textContent === "Test wieloturowości")).toHaveLength(1);
  expect(runCloudConformance).not.toHaveBeenCalled();
});

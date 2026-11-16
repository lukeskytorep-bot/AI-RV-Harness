// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { getCopy } from "../i18n";
import { executeProviderChat } from "../providers/requestExecutor";
import type { ProviderConfig } from "../providers/types";
import type { AppRepository } from "../storage/repository";
import { SqliteSettingsModelsRepository } from "../storage/sqlite/settingsModelsRepository";
import { ProviderSettings } from "./ProviderSettings";

vi.mock("../storage", () => ({ isTauriRuntime: () => true }));
vi.mock("../providers/native", () => ({
  storeCredentialSecret: vi.fn(),
  deleteCredentialSecret: vi.fn(),
  discoverModels: vi.fn(async () => []),
}));
vi.mock("./AppDialogProvider", () => ({ useAppDialogs: () => ({}) }));

it.each([true, false])("saves a new Custom SSE choice (%s) and uses it for the first request", async enabled => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const db = new DatabaseSync(":memory:");
  for (const file of ["001_initial.sql", "002_provider_registry.sql"]) {
    db.exec(readFileSync(`src-tauri/migrations/${file}`, "utf8"));
  }
  const statements = (query: string, values: unknown[]) => {
    const ordered: unknown[] = [];
    const stmt = db.prepare(query.replace(/\$(\d+)/g, (_, index) => { ordered.push(values[Number(index) - 1]); return "?"; }));
    return { stmt, ordered: ordered as never[] };
  };
  const repo = new SqliteSettingsModelsRepository({
    select: async <T,>(query: string, values: unknown[] = []) => {
      const { stmt, ordered } = statements(query, values);
      return stmt.all(...ordered) as T;
    },
    executeWrite: async () => ({ rowsAffected: 1 }),
    executeTransaction: async items => {
      db.exec("BEGIN");
      try {
        for (const { query, values } of items) {
          const { stmt, ordered } = statements(query, values ?? []);
          stmt.run(...ordered);
        }
        db.exec("COMMIT");
        return [];
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
  });
  let created: ProviderConfig | undefined;
  const repository = {
    listProviderConfigs: repo.listProviderConfigs.bind(repo),
    listProviderModels: async () => [],
    createProviderConfig: async (input: Parameters<typeof repo.createProviderConfig>[0]) => (created = await repo.createProviderConfig(input)),
  } as unknown as AppRepository;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const copy = getCopy("en");
  try {
    await act(async () => root.render(<ProviderSettings copy={copy} repository={repository} section="providers" />));
    await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === copy.addProvider)!.click());
    const dialog = host.querySelector("[role=dialog]")!;
    expect(dialog.querySelector("[type=checkbox]")).toBeNull();
    await act(async () => {
      const select = dialog.querySelector("select")!;
      select.value = "custom_openai";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const checkbox = dialog.querySelector<HTMLInputElement>("[type=checkbox]")!;
    expect(checkbox.checked).toBe(true);
    if (!enabled) await act(async () => checkbox.click());
    await act(async () => {
      for (const [type, text] of [["url", "https://example.test/v1"], ["password", "test-key"]]) {
        const field = dialog.querySelector<HTMLInputElement>(`input[type=${type}]`)!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, text);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await act(async () => { dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await vi.waitFor(() => expect(created?.customStreamingEnabled).toBe(enabled));
    const verifyTransport = async (config: ProviderConfig, streaming: boolean) => {
      const attempt = vi.fn(async () => ({ content: "ok", usage: {} }));
      await executeProviderChat({ config, modelId: "m", messages: [], settings: { requested: {}, effective: {}, omitted: [] }, operationKind: "conversation", attempt });
      expect(attempt).toHaveBeenCalledWith(expect.objectContaining({
        transportEnvelope: expect.objectContaining({ streamingMode: streaming ? "streaming" : "non_streaming" }),
      }));
    };
    await verifyTransport(created!, enabled);
    expect((await repo.listProviderConfigs())[0].customStreamingEnabled).toBe(enabled);
    await vi.waitFor(() => expect(host.querySelector<HTMLButtonElement>(`button[title="${copy.customWireSettings}"]`)?.disabled).toBe(false));
    await act(async () => host.querySelector<HTMLButtonElement>(`button[title="${copy.customWireSettings}"]`)!.click());
    expect(host.querySelector<HTMLInputElement>("[role=dialog] input[type=checkbox]")!.checked).toBe(enabled);

    db.prepare("DELETE FROM app_settings WHERE key = ?").run(`provider.customStreamingEnabled.${created!.id}`);
    const legacy = (await repo.listProviderConfigs())[0];
    expect(legacy.customStreamingEnabled).toBe(false);
    await verifyTransport(legacy, false);
    const other = await repo.createProviderConfig({ id: "other", provider: "openai", label: "Other", credentialId: "other-key" });
    expect(other.customStreamingEnabled).toBeUndefined();
    await verifyTransport(other, false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    db.close();
  }
});

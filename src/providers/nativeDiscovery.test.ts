import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../storage";
import { discoverNativeConnection, listNativeConnections, saveNativeConnection } from "./nativeDiscovery";
import type { NativeConnectionSnapshot } from "./nativeConnectionIdentity";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../storage", () => ({ isTauriRuntime: vi.fn(() => true) }));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(isTauriRuntime).mockReturnValue(true); });
it("keeps pending discovery on dedicated IPC with exact binding and model", async () => {
  const binding: NativeConnectionSnapshot = { version: 1, provider: "ollama_native", providerConfigId: "pending", connectionIdentityId: "identity", connectionRevision: 2, normalizedEndpoint: "https://proxy.example/prefix", authMode: "bearer" };
  await discoverNativeConnection(binding, "family:exact-tag"); expect(invoke).toHaveBeenCalledExactlyOnceWith("native_connection_discover", { binding, selectedModel: "family:exact-tag" });
});
it("saves explicit None without generating or using the legacy provider API", async () => {
  const input = { label: "Local", baseUrl: "http://localhost:11434", authMode: "none" as const };
  await saveNativeConnection(input); expect(invoke).toHaveBeenCalledExactlyOnceWith("native_connection_save", { input });
});
it("does not call native discovery or store credentials from Browser mode", async () => {
  vi.mocked(isTauriRuntime).mockReturnValue(false); await expect(listNativeConnections()).rejects.toThrow("desktop"); await expect(saveNativeConnection({ label: "Local", baseUrl: "http://localhost:11434", authMode: "none" })).rejects.toThrow("desktop"); expect(invoke).not.toHaveBeenCalled();
});

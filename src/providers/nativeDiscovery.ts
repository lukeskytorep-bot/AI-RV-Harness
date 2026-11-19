/** Pending Ollama settings/discovery only. Never dispatched as a legacy ProviderKind. */
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../storage";
import type { NativeConnection, NativeConnectionSnapshot } from "./nativeConnectionIdentity";
export interface NativeDiscovery {
  binding: NativeConnectionSnapshot;
  serverVersion?: string | null;
  capturedAtMs: number;
  models: { name: string; digest?: string }[];
  selectedModel?: string;
  selectedAvailable: boolean;
  details?: { sourceSha256: string; declaredContextTokens?: number; contextAllocationVerified: false; metadataSource?: "cloud_tags"; capabilities?: unknown; thinking?: unknown; details?: unknown; renderer?: unknown; parser?: unknown; template_source?: unknown };
  detailsUnavailable: boolean;
  generationAvailable: false;
}
export interface NativeConnectionView { connection: NativeConnection; discovery?: NativeDiscovery }
export interface NativeConnectionInput { expected?: NativeConnectionSnapshot; label: string; baseUrl: string; authMode: "none" | "bearer"; apiKey?: string; selectedModel?: string }
function desktop() { if (!isTauriRuntime()) throw new Error("Native discovery requires the desktop application."); }
export async function listNativeConnections(): Promise<NativeConnectionView[]> { desktop(); return invoke("native_connection_list"); }
export async function saveNativeConnection(input: NativeConnectionInput): Promise<NativeConnectionView> { desktop(); return invoke("native_connection_save", { input }); }
export async function discoverNativeConnection(binding: NativeConnectionSnapshot, selectedModel?: string): Promise<NativeDiscovery> { desktop(); return invoke("native_connection_discover", { binding, selectedModel }); }

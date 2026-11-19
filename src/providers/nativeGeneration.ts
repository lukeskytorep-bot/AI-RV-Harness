/** DIRECT-3C1: pending numeric preferences and frozen drafts; never authorizes generation. */
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../storage";
import { freezeNativeConnection, normalizeNativeConnectionEndpoint, type NativeConnectionSnapshot } from "./nativeConnectionIdentity";
import type { NativeConnectionView, NativeDiscovery } from "./nativeDiscovery";
export interface NativeGenerationSettings { numCtx?: number; temperature?: number; topP?: number; topK?: number; seed?: number }
export interface NativeGenerationReadiness { generationAvailable: false; reasons: string[]; declaredContextTokens?: number; requestedContextTokens?: number; observedRunningContextTokens?: number }
export interface NativeGenerationDraft { version: 1; binding: NativeConnectionSnapshot; model: string; settings: NativeGenerationSettings }
export interface NativeGenerationState { draft: NativeGenerationDraft; readiness: NativeGenerationReadiness }
export type NativeGenerationRole = "viewer" | "monitor" | "judge" | "learning" | "post_reveal" | "conversation" | "telepathic_participant" | "telepathic_facilitator";
export interface NativeModelProvenance { serverVersion: string; model: string; digest: string; metadataSha256: string }
export interface NativeGenerationSnapshot { version: 1; connection: NativeConnectionSnapshot; provenance: NativeModelProvenance; settings: NativeGenerationSettings; role: NativeGenerationRole; maxOutputTokens: number }
const roles: readonly string[] = ["viewer", "monitor", "judge", "learning", "post_reveal", "conversation", "telepathic_participant", "telepathic_facilitator"];
export function validateNativeGenerationSettings(value: NativeGenerationSettings): void {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !["numCtx", "temperature", "topP", "topK", "seed"].includes(k))) throw new Error("Invalid native generation settings.");
  for (const key of ["numCtx", "topK", "seed"] as const) if (value[key] !== undefined && (!Number.isSafeInteger(value[key]) || value[key]! < (key === "numCtx" ? 1 : 0))) throw new Error("Invalid native integer setting.");
  for (const [key, max] of [["temperature", 2], ["topP", 1]] as const) if (value[key] !== undefined && (!Number.isFinite(value[key]) || value[key]! < 0 || value[key]! > max)) throw new Error("Invalid native sampling setting.");
}
export function nativeModelProvenance(d: NativeDiscovery): NativeModelProvenance {
  const m = d.models.find(m => m.name === d.selectedModel);
  const p = { serverVersion: d.serverVersion, model: d.selectedModel ?? "", digest: m?.digest ?? "", metadataSha256: d.details?.sourceSha256 ?? "" };
  if (!d.selectedAvailable || !p.model || /\s/.test(p.model) || [p.serverVersion, p.model, p.digest].some(v => !v.trim() || v.length > 512 || /[\u0000-\u001f\u007f]/.test(v)) || !/^[\da-f]{64}$/i.test(p.metadataSha256)) throw new Error("Native model provenance is incomplete.");
  return p;
}
export function freezeNativeGeneration(view: NativeConnectionView, settings: NativeGenerationSettings, role: NativeGenerationRole, maxOutputTokens: number): NativeGenerationSnapshot {
  validateNativeGenerationSettings(settings);
  if (!roles.includes(role) || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || !view.discovery) throw new Error("Invalid native generation snapshot.");
  const connection = freezeNativeConnection(view.connection);
  if ((Object.keys(connection) as (keyof NativeConnectionSnapshot)[]).some(k => connection[k] !== view.discovery!.binding[k])) throw new Error("Stale native discovery binding.");
  const snapshot = { version: 1 as const, connection, provenance: nativeModelProvenance(view.discovery), settings: { ...settings }, role, maxOutputTokens };
  Object.freeze(snapshot.connection); Object.freeze(snapshot.provenance); Object.freeze(snapshot.settings); return Object.freeze(snapshot);
}
export function assertNativeGenerationCompatible(snapshot: NativeGenerationSnapshot, view: NativeConnectionView): void {
  const current = freezeNativeGeneration(view, snapshot.settings, snapshot.role, snapshot.maxOutputTokens);
  if (snapshot.version !== 1 || (Object.keys(current.connection) as (keyof NativeConnectionSnapshot)[]).some(k => current.connection[k] !== snapshot.connection[k]) || (Object.keys(current.provenance) as (keyof NativeModelProvenance)[]).some(k => current.provenance[k] !== snapshot.provenance[k])) throw new Error("Native connection or model provenance changed; frozen run is incompatible.");
}
export function draftNativeNonStreamRequest(snapshot: NativeGenerationSnapshot, messages: readonly { role: "system" | "user" | "assistant"; content: string }[]) {
  validateNativeGenerationSettings(snapshot.settings);
  const b = snapshot.connection, p = snapshot.provenance;
  if (!b || b.version !== 1 || b.provider !== "ollama_native" || !b.providerConfigId || !b.connectionIdentityId || !Number.isSafeInteger(b.connectionRevision) || b.connectionRevision < 1 || !["none", "bearer"].includes(b.authMode) || normalizeNativeConnectionEndpoint(b.normalizedEndpoint) !== b.normalizedEndpoint || !p || [p.serverVersion, p.model, p.digest].some(v => typeof v !== "string" || !v.trim() || v.length > 512 || /[\u0000-\u001f\u007f]/.test(v)) || /\s/.test(p.model) || !/^[\da-f]{64}$/i.test(p.metadataSha256)) throw new Error("Invalid native snapshot provenance.");
  if (snapshot.version !== 1 || !roles.includes(snapshot.role) || !Number.isSafeInteger(snapshot.maxOutputTokens) || snapshot.maxOutputTokens < 1 || !messages.length || messages.at(-1)?.role !== "user" || messages.some(m => !["system", "user", "assistant"].includes(m.role) || typeof m.content !== "string" || Object.keys(m).some(k => !["role", "content"].includes(k)))) throw new Error("Invalid native request draft.");
  const options: Record<string, number> = { num_predict: snapshot.maxOutputTokens };
  for (const [key, wire] of [["numCtx", "num_ctx"], ["temperature", "temperature"], ["topP", "top_p"], ["topK", "top_k"], ["seed", "seed"]] as const) if (snapshot.settings[key] !== undefined) options[wire] = snapshot.settings[key];
  const request = { model: snapshot.provenance.model, messages: messages.map(m => ({ ...m })), stream: false, options };
  if (new TextEncoder().encode(JSON.stringify(request)).byteLength > 16 * 1024 * 1024) throw new Error("Native request exceeds 16 MiB.");
  return request;
}
function desktop() { if (!isTauriRuntime()) throw new Error("Native preferences require the desktop application."); }
export async function getNativeGenerationSettings(binding: NativeConnectionSnapshot, model: string): Promise<NativeGenerationState> { desktop(); return invoke("native_connection_generation_settings", { binding, model }); }
export async function saveNativeGenerationSettings(draft: NativeGenerationDraft): Promise<NativeGenerationState> { desktop(); validateNativeGenerationSettings(draft.settings); return invoke("native_connection_save_generation_settings", { draft }); }

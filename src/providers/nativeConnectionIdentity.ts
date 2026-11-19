/** DIRECT-3B1 storage contract. This is not an enabled ProviderKind or HTTP transport. */
export interface NativeConnectionBase {
  id: string;
  provider: "ollama_native";
  label: string;
  baseUrl: string;
  connectionIdentityId: string;
  connectionRevision: number;
  enabled: false;
}
export type NativeConnection = NativeConnectionBase & (
  | { authMode: "none"; credentialId?: never }
  | { authMode: "bearer"; credentialId: string }
);
export interface NativeConnectionSnapshot {
  version: 1;
  provider: "ollama_native";
  providerConfigId: string;
  connectionIdentityId: string;
  connectionRevision: number;
  normalizedEndpoint: string;
  authMode: "none" | "bearer";
}
export interface NativeConnectionAiIdentity {
  id: string;
  profileId: string;
  providerConfigId: string;
  provider: "ollama_native";
  identityKind: "connection";
  connectionIdentityId: string;
  connectionRevision: number;
  normalizedBaseUrl: string;
  modelId: string;
  modelRoute: string;
  modelDisplayName: string;
  role: "viewer";
}
export function normalizeNativeConnectionEndpoint(input: string): string {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error("Invalid native connection URL."); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new Error("Native connection requires HTTPS or loopback HTTP.");
  if (url.pathname.includes("%") || url.username || url.password || url.search || url.hash || input.includes("?") || input.includes("#")) throw new Error("Native connection URL must not contain credentials, query or fragment.");
  const path = url.pathname.replace(/\/+$/, "");
  if (/(?:^|\/)(?:api|v1)(?:\/|$)/i.test(decodeURIComponent(path))) throw new Error("Enter the native server base before /api, not an API endpoint or /v1.");
  url.pathname = path;
  return url.toString().replace(/\/+$/, "");
}
export function validateNativeConnection(value: NativeConnection): NativeConnection {
  const object = value as unknown as Record<string, unknown>;
  if (["apiKey","secret"].some(k=>object[k]!=null)) throw new Error("Secrets must not be part of native connection metadata.");
  if (value.provider !== "ollama_native" || !value.id?.trim() || !value.connectionIdentityId?.trim() || !value.label?.trim() || value.enabled !== false
    || !Number.isSafeInteger(value.connectionRevision) || value.connectionRevision < 1
    || normalizeNativeConnectionEndpoint(value.baseUrl) !== value.baseUrl) throw new Error("Invalid pending native connection.");
  if (value.authMode !== "none" && value.authMode !== "bearer") throw new Error("Explicit native authentication mode is required.");
  if (value.authMode === "none" && (object.credentialId != null || object.credentialFingerprint != null || object.credentialHint != null)) throw new Error("Keyless connection must not contain credential metadata.");
  if (value.authMode === "bearer" && !value.credentialId?.trim()) throw new Error("Bearer connection requires a bound credential.");
  return value;
}
export function freezeNativeConnection(value: NativeConnection): NativeConnectionSnapshot {
  validateNativeConnection(value);
  return { version: 1, provider: value.provider, providerConfigId: value.id, connectionIdentityId: value.connectionIdentityId,
    connectionRevision: value.connectionRevision, normalizedEndpoint: value.baseUrl, authMode: value.authMode };
}
export function assertNativeConnectionSnapshot(current: NativeConnection, snapshot: NativeConnectionSnapshot): void {
  const expected = freezeNativeConnection(current);
  if (Object.keys(expected).some(key => expected[key as keyof NativeConnectionSnapshot] !== snapshot[key as keyof NativeConnectionSnapshot])) throw new Error("Native connection identity, endpoint, authentication or revision changed.");
}
export function validateNativeConnectionAiIdentity(value: NativeConnectionAiIdentity): NativeConnectionAiIdentity {
  const object=value as unknown as Record<string,unknown>;
  if(value.provider!=="ollama_native" || value.identityKind!=="connection" || value.role!=="viewer" || !value.id?.trim() || !value.profileId?.trim() || !value.providerConfigId?.trim() || !value.connectionIdentityId?.trim()
    || !Number.isSafeInteger(value.connectionRevision) || value.connectionRevision<1 || !value.modelId?.trim() || value.modelRoute!==`ollama_native:${value.modelId}`
    || normalizeNativeConnectionEndpoint(value.normalizedBaseUrl)!==value.normalizedBaseUrl
    || ["credentialId","credentialFingerprint","credentialDisplay","credentialHint","apiKey","secret"].some(k=>object[k]!=null))throw new Error("Invalid native AI connection identity.");
  return value;
}

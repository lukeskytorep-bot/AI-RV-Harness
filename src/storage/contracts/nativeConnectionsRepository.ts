import type { NativeConnection, NativeConnectionAiIdentity, NativeConnectionSnapshot } from "../../providers/nativeConnectionIdentity";
/** Pending metadata only. No generation/discovery activation or secret-store API. */
export interface NativeConnectionsRepository {
  createPendingKeylessConnection(input: { id: string; label: string; baseUrl: string }): Promise<NativeConnection>;
  getNativeConnection(id: string): Promise<NativeConnection | null>;
  bindPendingNativeProfile(profileId: string, binding: NativeConnectionSnapshot): Promise<void>;
  getPendingNativeProfile(profileId: string): Promise<NativeConnectionSnapshot | null>;
  ensurePendingNativeAiIdentity(input: { profileId: string; binding: NativeConnectionSnapshot; modelId: string; modelDisplayName: string }): Promise<NativeConnectionAiIdentity>;
  getPendingNativeAiIdentity(id: string): Promise<NativeConnectionAiIdentity | null>;
}

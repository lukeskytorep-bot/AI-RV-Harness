import { validateNativeConnectionAiIdentity, assertNativeConnectionSnapshot, validateNativeConnection, type NativeConnection, type NativeConnectionAiIdentity, type NativeConnectionSnapshot } from "../../providers/nativeConnectionIdentity";
import type { NativeConnectionsRepository } from "../contracts/nativeConnectionsRepository";
/** Browser reads imported metadata only; creating native connections/identities remains desktop-only. */
export class BrowserNativeConnectionsRepository implements NativeConnectionsRepository {
  constructor(private readonly storage:Storage=localStorage){}
  private read<T>(key:string):T[] {return JSON.parse(this.storage.getItem(key)??"[]") as T[];}
  async getNativeConnection(id:string):Promise<NativeConnection|null>{const c=this.read<NativeConnection>("rvh.dev.native_connections.v1").find(c=>c.id===id);return c?validateNativeConnection(c):null;}
  async getPendingNativeProfile(profileId:string):Promise<NativeConnectionSnapshot|null>{const r=this.read<{profileId:string;binding:NativeConnectionSnapshot}>("rvh.dev.native_profile_routes.v1").find(r=>r.profileId===profileId);if(!r)return null;const c=await this.getNativeConnection(r.binding.providerConfigId);if(!c)throw new Error("Native connection not found.");assertNativeConnectionSnapshot(c,r.binding);return r.binding;}
  async getPendingNativeAiIdentity(id:string):Promise<NativeConnectionAiIdentity|null>{const value=this.read<NativeConnectionAiIdentity>("rvh.dev.native_ai_identities.v1").find(i=>i.id===id);return value?validateNativeConnectionAiIdentity(value):null;}
  createPendingKeylessConnection():Promise<never>{return Promise.reject(new Error("Native connections require the desktop runtime."));}
  bindPendingNativeProfile():Promise<never>{return Promise.reject(new Error("Native connections require the desktop runtime."));}
  ensurePendingNativeAiIdentity():Promise<never>{return Promise.reject(new Error("Native identities require the desktop runtime."));}
}

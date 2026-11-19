import { validateNativeConnectionAiIdentity, assertNativeConnectionSnapshot, freezeNativeConnection, normalizeNativeConnectionEndpoint, validateNativeConnection, type NativeConnection, type NativeConnectionAiIdentity, type NativeConnectionSnapshot } from "../../providers/nativeConnectionIdentity";
import type { NativeConnectionsRepository } from "../contracts/nativeConnectionsRepository";
import { createId, nowIso } from "../repository";
import type { DatabaseTransactionStatement } from "../databaseNative";
export const NATIVE_CONNECTION_SQL = {
  create: "INSERT INTO provider_configs(id,provider,label,credential_id,credential_hint,base_url,enabled,created_at,updated_at,auth_mode,connection_identity_id,connection_revision) VALUES($1,'ollama_native',$2,NULL,NULL,$3,0,$4,$4,'none',$5,1)",
  bind: "INSERT INTO profile_native_connection_routes(profile_id,provider_config_id,connection_identity_id,connection_revision,normalized_endpoint,created_at) VALUES($1,$2,$3,$4,$5,$6)",
  identity: "INSERT INTO ai_identities(id,profile_id,credential_fingerprint,credential_display,provider_config_id,provider,normalized_base_url,model_id,model_route,model_display_name,role,route_status,first_used_at,last_used_at,created_at,updated_at,identity_kind,connection_identity_id,connection_revision) VALUES($1,$2,NULL,NULL,$3,'ollama_native',$4,$5,$6,$7,'viewer','unavailable',$8,$8,$8,$8,'connection',$9,$10) ON CONFLICT DO NOTHING",
} as const;
type Dependencies = { select<T>(query: string, values?: unknown[]): Promise<T>; executeTransaction(statements: DatabaseTransactionStatement[]): Promise<unknown>; };
type ConnectionRow = { id:string;provider:string;label:string;base_url:string;auth_mode:string;credential_id:string|null;credential_hint:string|null;connection_identity_id:string;connection_revision:number;enabled:number; };
type IdentityRow = { id:string;profile_id:string;provider_config_id:string;connection_identity_id:string;connection_revision:number;normalized_base_url:string;model_id:string;model_route:string;model_display_name:string; };
export class SqliteNativeConnectionsRepository implements NativeConnectionsRepository {
  constructor(private readonly dependencies: Dependencies) {}
  async createPendingKeylessConnection(input: { id:string;label:string;baseUrl:string }): Promise<NativeConnection> {
    const connection:NativeConnection = {id:input.id,provider:"ollama_native",label:input.label.trim(),baseUrl:normalizeNativeConnectionEndpoint(input.baseUrl),connectionIdentityId:createId("connection_identity"),connectionRevision:1,authMode:"none",enabled:false};
    validateNativeConnection(connection);
    await this.dependencies.executeTransaction([{query:NATIVE_CONNECTION_SQL.create,values:[connection.id,connection.label,connection.baseUrl,nowIso(),connection.connectionIdentityId]}]);
    return connection;
  }
  async getNativeConnection(id:string):Promise<NativeConnection|null> {
    const [r]=await this.dependencies.select<ConnectionRow[]>("SELECT * FROM provider_configs WHERE id=$1 AND provider='ollama_native'",[id]);
    if(!r)return null;
    const common={id:r.id,provider:"ollama_native" as const,label:r.label,baseUrl:r.base_url,connectionIdentityId:r.connection_identity_id,connectionRevision:Number(r.connection_revision),enabled:r.enabled!==0};
    if(r.auth_mode==="none" && (r.credential_id!==null || r.credential_hint!==null))throw new Error("Invalid keyless credential binding.");
    const value={...common,authMode:r.auth_mode,...(r.auth_mode==="bearer"?{credentialId:r.credential_id}:{})} as NativeConnection;
    return validateNativeConnection(value);
  }
  private async verify(binding:NativeConnectionSnapshot):Promise<NativeConnection> {
    const current=await this.getNativeConnection(binding.providerConfigId);
    if(!current)throw new Error("Native connection not found.");
    assertNativeConnectionSnapshot(current,binding);
    if(current.authMode!=="none")throw new Error("Bearer identity requires native credential verification in the configuration stage.");
    return current;
  }
  async bindPendingNativeProfile(profileId:string,binding:NativeConnectionSnapshot):Promise<void> {
    await this.verify(binding);
    await this.dependencies.executeTransaction([{query:NATIVE_CONNECTION_SQL.bind,values:[profileId,binding.providerConfigId,binding.connectionIdentityId,binding.connectionRevision,binding.normalizedEndpoint,nowIso()]}]);
  }
  async getPendingNativeProfile(profileId:string):Promise<NativeConnectionSnapshot|null> {
    const [r]=await this.dependencies.select<{provider_config_id:string;connection_identity_id:string;connection_revision:number;normalized_endpoint:string}[]>("SELECT * FROM profile_native_connection_routes WHERE profile_id=$1",[profileId]);
    if(!r)return null;
    const binding:NativeConnectionSnapshot={version:1,provider:"ollama_native",providerConfigId:r.provider_config_id,connectionIdentityId:r.connection_identity_id,connectionRevision:Number(r.connection_revision),normalizedEndpoint:r.normalized_endpoint,authMode:"none"};
    await this.verify(binding);return binding;
  }
  async ensurePendingNativeAiIdentity(input:{profileId:string;binding:NativeConnectionSnapshot;modelId:string;modelDisplayName:string}):Promise<NativeConnectionAiIdentity> {
    const connection=await this.verify(input.binding);const route=await this.getPendingNativeProfile(input.profileId);
    if(!route || JSON.stringify(route)!==JSON.stringify(freezeNativeConnection(connection)))throw new Error("Native profile route mismatch.");
    if(!input.modelId.trim() || /[\u0000-\u0020\u007f]/u.test(input.modelId))throw new Error("Exact native model identifier is required.");
    const id=createId("ai_connection_identity"),modelRoute=`ollama_native:${input.modelId}`;
    await this.dependencies.executeTransaction([{query:NATIVE_CONNECTION_SQL.identity,values:[id,input.profileId,connection.id,connection.baseUrl,input.modelId,modelRoute,input.modelDisplayName,nowIso(),connection.connectionIdentityId,connection.connectionRevision]}]);
    const [row]=await this.dependencies.select<{id:string}[]>("SELECT id FROM ai_identities WHERE identity_kind='connection' AND profile_id=$1 AND connection_identity_id=$2 AND connection_revision=$3 AND model_route=$4",[input.profileId,connection.connectionIdentityId,connection.connectionRevision,modelRoute]);
    const value=row?await this.getPendingNativeAiIdentity(row.id):null;if(!value)throw new Error("Native identity was not saved.");return value;
  }
  async getPendingNativeAiIdentity(id:string):Promise<NativeConnectionAiIdentity|null> {
    const [r]=await this.dependencies.select<IdentityRow[]>("SELECT * FROM ai_identities WHERE id=$1 AND identity_kind='connection' AND role='viewer'",[id]);
    return r?validateNativeConnectionAiIdentity({id:r.id,profileId:r.profile_id,providerConfigId:r.provider_config_id,provider:"ollama_native",identityKind:"connection",connectionIdentityId:r.connection_identity_id,connectionRevision:Number(r.connection_revision),normalizedBaseUrl:r.normalized_base_url,modelId:r.model_id,modelRoute:r.model_route,modelDisplayName:r.model_display_name,role:"viewer"}):null;
  }
}

// @vitest-environment jsdom
import { afterEach,it,expect } from "vitest";
import { BrowserNativeConnectionsRepository } from "./browser/nativeConnectionsRepository";
import { freezeNativeConnection,type NativeConnection } from "../providers/nativeConnectionIdentity";
const connection:NativeConnection={id:"p",provider:"ollama_native",label:"Local",baseUrl:"http://localhost:11434",connectionIdentityId:"connection-1",connectionRevision:1,authMode:"none",enabled:false};
afterEach(()=>localStorage.clear());
it("reopens metadata using explicit identity and refuses stale or forged authentication",async()=>{
 localStorage.setItem("rvh.dev.native_connections.v1",JSON.stringify([connection]));const snapshot=freezeNativeConnection(connection);
 localStorage.setItem("rvh.dev.native_profile_routes.v1",JSON.stringify([{profileId:"profile",binding:snapshot}]));
 expect(await new BrowserNativeConnectionsRepository().getPendingNativeProfile("profile")).toEqual(snapshot);
 const repo=new BrowserNativeConnectionsRepository();await expect(repo.createPendingKeylessConnection()).rejects.toThrow(/desktop/);await expect(repo.bindPendingNativeProfile()).rejects.toThrow(/desktop/);await expect(repo.ensurePendingNativeAiIdentity()).rejects.toThrow(/desktop/);
 localStorage.setItem("rvh.dev.native_profile_routes.v1",JSON.stringify([{profileId:"profile",binding:{...snapshot,authMode:"bearer"}}]));await expect(repo.getPendingNativeProfile("profile")).rejects.toThrow(/changed/);
 localStorage.setItem("rvh.dev.native_connections.v1",JSON.stringify([{...connection,connectionRevision:2}]));localStorage.setItem("rvh.dev.native_profile_routes.v1",JSON.stringify([{profileId:"profile",binding:snapshot}]));await expect(repo.getPendingNativeProfile("profile")).rejects.toThrow(/changed/);
});

it("rejects imported identities that smuggle a credential fingerprint into the connection namespace",async()=>{
 localStorage.setItem("rvh.dev.native_ai_identities.v1",JSON.stringify([{id:"ai",profileId:"profile",providerConfigId:"p",provider:"ollama_native",identityKind:"connection",connectionIdentityId:"connection-1",connectionRevision:1,normalizedBaseUrl:"http://localhost:11434",modelId:"m",modelRoute:"ollama_native:m",modelDisplayName:"M",role:"viewer",credentialFingerprint:"fake"}]));
 await expect(new BrowserNativeConnectionsRepository().getPendingNativeAiIdentity("ai")).rejects.toThrow(/Invalid native AI/);
});

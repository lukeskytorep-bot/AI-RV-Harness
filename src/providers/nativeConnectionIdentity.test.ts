import { it,expect } from "vitest";
import { normalizeNativeConnectionEndpoint,validateNativeConnection,freezeNativeConnection,assertNativeConnectionSnapshot,type NativeConnection } from "./nativeConnectionIdentity";
const connection=():NativeConnection=>({id:"p",provider:"ollama_native",label:"Local",baseUrl:"http://localhost:11434",connectionIdentityId:"real-connection-identity",connectionRevision:1,enabled:false,authMode:"none"});
it("preserves explicit keyless identity and binds every snapshot field without a synthetic fingerprint",()=>{
 const c=connection(),snapshot=freezeNativeConnection(c);expect(snapshot).not.toHaveProperty("credentialId");expect(snapshot).not.toHaveProperty("credentialFingerprint");
 expect(()=>assertNativeConnectionSnapshot(c,JSON.parse(JSON.stringify(snapshot)))).not.toThrow();
 for(const patch of [{providerConfigId:"q"},{authMode:"bearer"},{connectionRevision:2},{connectionIdentityId:"new"},{normalizedEndpoint:"https://other.invalid"},{version:2}])expect(()=>assertNativeConnectionSnapshot(c,{...snapshot,...patch} as never)).toThrow(/changed/);
});
it("requires an explicit mode, credentials only for bearer, disabled staging and safe revisions",()=>{
 for(const patch of [{authMode:undefined},{authMode:"unknown"},{credentialId:"fake"},{credentialFingerprint:"fake"},{credentialHint:"fake"},{apiKey:"do-not-return"},{enabled:true},{connectionRevision:0},{connectionRevision:1.5},{connectionRevision:Number.MAX_SAFE_INTEGER+1}])expect(()=>validateNativeConnection({...connection(),...patch} as never)).toThrow();
 expect(()=>validateNativeConnection({...connection(),authMode:"bearer",credentialId:"bound"})).not.toThrow();
 expect(()=>validateNativeConnection({...connection(),authMode:"bearer"} as never)).toThrow();
});
it("normalizes only supported server bases with path case retained and exact loopback policy",()=>{
 expect(normalizeNativeConnectionEndpoint(" HTTP://LOCALHOST:11434/ ")).toBe("http://localhost:11434");
 expect(normalizeNativeConnectionEndpoint("http://[::1]:11434/")).toBe("http://[::1]:11434");
 expect(normalizeNativeConnectionEndpoint("https://Proxy.invalid/Ollama/")).toBe("https://proxy.invalid/Ollama");
 for(const url of ["http://127.0.0.2:11434","http://192.168.0.1:11434","https://u:p@host.invalid","https://host.invalid?","https://host.invalid#x","https://host.invalid/api/chat","https://host.invalid/v1","https://host.invalid/%61pi"])expect(()=>normalizeNativeConnectionEndpoint(url)).toThrow();
});

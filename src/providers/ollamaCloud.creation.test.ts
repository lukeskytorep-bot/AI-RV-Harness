import {beforeEach, expect, it, vi} from "vitest";
vi.mock("./native", () => ({activateOllamaCloud:vi.fn(),changeCustomOpenAiEndpoint:vi.fn(),deleteCredentialSecret:vi.fn(),discoverModels:vi.fn(),hasCredentialSecret:vi.fn(),providerBindingEndpoint:vi.fn(),rebindCredentialSecret:vi.fn(),storeCredentialSecret:vi.fn()}));
vi.mock("./nativeDiscovery",()=>({saveNativeConnection:vi.fn()}));
import {addProvider} from "./service";
import {storeCredentialSecret,activateOllamaCloud} from "./native";
import {saveNativeConnection} from "./nativeDiscovery";
import type {AppRepository} from "../storage/repository";
const create=vi.fn(),list=vi.fn();const repository={createProviderConfig:create,listProviderConfigs:list} as unknown as AppRepository;
beforeEach(()=>vi.resetAllMocks());
it("does not create a selectable route when the hosted authorization test fails",async()=>{
 vi.mocked(saveNativeConnection).mockRejectedValue(new Error("HTTP 401"));await expect(addProvider(repository,{provider:"ollama_cloud",label:"Cloud",apiKey:"fixture-secret"})).rejects.toThrow("HTTP 401");expect(create).not.toHaveBeenCalled();expect(activateOllamaCloud).not.toHaveBeenCalled();expect(storeCredentialSecret).not.toHaveBeenCalled();
});
it("uses the staged native save/activation route and returns the committed hosted identity",async()=>{
 const connection={id:"source",provider:"ollama_native" as const,label:"Cloud",baseUrl:"https://ollama.com",authMode:"bearer" as const,credentialId:"opaque-source",connectionIdentityId:"identity",connectionRevision:1,enabled:false};
 vi.mocked(saveNativeConnection).mockResolvedValue({connection});vi.mocked(activateOllamaCloud).mockResolvedValue("hosted");list.mockResolvedValue([{id:"hosted",provider:"ollama_cloud",credentialId:"opaque-hosted",label:"Cloud",enabled:true,createdAt:"t",updatedAt:"t"}]);
 const c=await addProvider(repository,{provider:"ollama_cloud",label:"Cloud",apiKey:"fixture-secret"});expect(c.provider).toBe("ollama_cloud");expect(saveNativeConnection).toHaveBeenCalledWith({label:"Cloud",baseUrl:"https://ollama.com",authMode:"bearer",apiKey:"fixture-secret"});expect(activateOllamaCloud).toHaveBeenCalledWith(expect.objectContaining({providerConfigId:"source",normalizedEndpoint:"https://ollama.com"}));expect(storeCredentialSecret).not.toHaveBeenCalled();expect(JSON.stringify(c)).not.toContain("fixture-secret");
});
it("rejects credentials in metadata and arbitrary hosted endpoints before secure storage or HTTP",async()=>{
 for(const input of [{label:"fixture-secret"},{label:"Cloud",baseUrl:"https://other.invalid"}])await expect(addProvider(repository,{provider:"ollama_cloud",apiKey:"fixture-secret",...input})).rejects.toThrow();expect(saveNativeConnection).not.toHaveBeenCalled();
});

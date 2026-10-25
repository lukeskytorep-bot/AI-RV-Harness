import {expect,it,vi} from "vitest";
const bridge=vi.hoisted(()=>({invoke:vi.fn(async()=>undefined)}));
vi.mock("@tauri-apps/api/core",()=>({invoke:bridge.invoke}));
import {executeControlledPurgeNative} from "./databaseNative";
it("Telepathy native purge carries the exact typed kind and confirmed archive revision",async()=>{
 await executeControlledPurgeNative("telepathic_series","series",7);
 expect(bridge.invoke).toHaveBeenCalledWith("database_controlled_purge",{request:{kind:"telepathic_series",id:"series",expectedArchiveRevision:7}});
});

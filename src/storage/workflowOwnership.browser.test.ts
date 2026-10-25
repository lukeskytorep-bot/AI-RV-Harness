// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {BrowserRepository} from "./browserRepository";
import {endRvSession,isRvSessionEnded} from "../sessions/termination";
import {assertAbortOwnership} from "../application/abortOwnership";
import {executeProviderRequest} from "../providers/requestExecutor";
import type {AppRepository} from "./repository";
function locks(){const held=new Set<string>();return{request:async(name:string,options:any,callback:any)=>{if(held.has(name))return callback(null);held.add(name);try{return await callback({name});}finally{held.delete(name);}}};}
let repository:BrowserRepository;let profileId:string;
beforeEach(async()=>{localStorage.clear();vi.stubGlobal("navigator",{locks:locks()});repository=new BrowserRepository();const profile=await repository.createProfile({name:"P"});profileId=profile.id;const workspace=await repository.createWorkspace({profileId,name:"W",kind:"rv"});await repository.createRvSession({id:"s",workspaceId:workspace.id,profileId,sessionCode:"S",runType:"automatic"});await repository.updatePreRevealTranscript("s","accepted blind");await repository.appendSessionEvent("s",{eventType:"VIEWER_OUTPUT_ATTEMPT",metadata:{status:"uncertain",requestSha256:"frozen",technicalAttempt:2}});});
afterEach(()=>{vi.unstubAllGlobals();localStorage.clear();});
it("Browser: another owner blocks End; settled callback cannot dispatch or write; End preserves evidence after restart",async()=>{
 const other=new BrowserRepository();let owned!:AppRepository;let signal!:AbortSignal;let release!:()=>void;let ready!:()=>void;const started=new Promise<void>(resolve=>{ready=resolve;});
 const task=repository.withWorkflowOwnership({profileId,entity:{kind:"rv",id:"s"}},async(scoped,current)=>{owned=scoped;signal=current;ready();await new Promise<void>(resolve=>{release=resolve;});});
 await started;try{expect(await other.getWorkflowOwnership(profileId)).toBe("other");await expect(endRvSession(other,"s")).rejects.toThrow(/another window/);await expect(endRvSession(owned,"s")).rejects.toThrow(/settle/);}finally{release();await task;}
 const before=await repository.getRvSession("s");const events=await repository.listSessionEvents("s");await endRvSession(other,"s","first");await endRvSession(other,"s","second");
 expect(await repository.getRvSession("s")).toEqual(before);expect((await repository.listSessionEvents("s")).slice(0,-1)).toEqual(events);expect((await repository.listSessionEvents("s")).filter(event=>event.eventType==="RV_USER_FINISHED")).toHaveLength(1);
 await expect(owned.updatePreRevealTranscript("s","late")).rejects.toThrow(/settled/);const transport=vi.fn();await expect(executeProviderRequest({operationId:"late",signal,configuredRetries:0,executeAttempt:transport})).rejects.toThrow();expect(transport).not.toHaveBeenCalled();expect(await isRvSessionEnded(new BrowserRepository(),"s")).toBe(true);await repository.archiveRvSession("s");await repository.restoreRvSession("s");expect(await isRvSessionEnded(repository,"s")).toBe(true);
});
it("Browser: failed End save retains evidence and manual retry succeeds",async()=>{
 const before=await repository.getRvSession("s");const original=Storage.prototype.setItem;const fail=vi.spyOn(Storage.prototype,"setItem").mockImplementation(function(this:Storage,key,value){if(value.includes("RV_USER_FINISHED"))throw new Error("marker write failed");return original.call(this,key,value);});
 await expect(endRvSession(repository,"s")).rejects.toThrow("marker write failed");fail.mockRestore();expect(await isRvSessionEnded(repository,"s")).toBe(false);expect(await repository.getRvSession("s")).toEqual(before);await endRvSession(repository,"s");expect(await isRvSessionEnded(repository,"s")).toBe(true);
});
it("Browser: loss of required Web Locks fails closed before workflow work",async()=>{
 vi.stubGlobal("navigator",{});const task=vi.fn();expect(await repository.getWorkflowOwnership(profileId)).toBe("unknown");await expect(repository.withWorkflowOwnership({profileId,entity:{kind:"rv",id:"s"}},task)).rejects.toThrow(/requires Web Locks/);expect(task).not.toHaveBeenCalled();
});
it("Browser: new-session scope tracks terminal state before another provider callback",async()=>{
 await repository.withWorkflowOwnership({profileId,entity:{kind:"profile",id:profileId}},async(owned,signal)=>{const workspace=(await repository.listWorkspaces(profileId))[0];await owned.createRvSession({id:"new",workspaceId:workspace.id,profileId,sessionCode:"N",runType:"automatic"});await repository.appendSessionEvent("new",{eventType:"RV_USER_FINISHED",metadata:{reason:"user_finished"}});await expect(assertAbortOwnership(signal)).rejects.toThrow(/ended/);await expect(owned.updatePreRevealTranscript("new","late")).rejects.toThrow(/ended/);});
});

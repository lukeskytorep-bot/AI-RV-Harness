import {it,expect,vi} from "vitest";
import {withWorkflow,withRvWorkflow} from "./workflowOwnership";
import {registerAbortOwnership,inheritAbortOwnership,assertAbortOwnership} from "./abortOwnership";
import {executeProviderRequest} from "../providers/requestExecutor";
it("missing ownership fails closed for direct workflow and RV ports",async()=>{
 const task=vi.fn();await expect(withWorkflow({} as never,{profileId:"p",entity:{kind:"profile",id:"p"}},task)).rejects.toThrow(/capability/);
 await expect(withRvWorkflow({} as never,"s",undefined,task)).rejects.toThrow(/identity capability/);expect(task).not.toHaveBeenCalled();
});
it("inherited verifier blocks dispatch when ownership changes during the attempt-start save",async()=>{
 const parent=new AbortController(),child=new AbortController();let valid=true;
 registerAbortOwnership(parent.signal,async()=>{if(!valid)throw new Error("ownership lost");});inheritAbortOwnership(child.signal,parent.signal);
 const transport=vi.fn();await expect(executeProviderRequest({operationId:"fenced",signal:child.signal,configuredRetries:0,onAttemptStart:async()=>{valid=false;},executeAttempt:transport})).rejects.toThrow();
 expect(transport).not.toHaveBeenCalled();await expect(assertAbortOwnership(child.signal)).rejects.toThrow(/ownership lost/);
});

// @vitest-environment jsdom
import { sha256Text } from "../application/sha256";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserRepository } from "./browserRepository";
import { createResearchEvaluation, evaluationScope, runResearchEvaluation } from "../research/evaluationEngine";
import { createResearchProtocolSelection } from "../research/protocolPolicy";
import { model, output, provider } from "../testing/researchJudgeRecoveryFixture";
import type { SessionSnapshot } from "../sessions/types";
import { evaluationKey } from "../research/evaluationTypes";
const locks=()=>{const held=new Set<string>();return{request:async(name:string,_options:unknown,callback:(lock:object|null)=>Promise<unknown>)=>{if(held.has(name))return callback(null);held.add(name);try{return await callback({name});}finally{held.delete(name);}}};};
afterEach(()=>{localStorage.clear();vi.unstubAllGlobals();});
it("Browser evaluation after End persists independently and refuses source writes, stale revisions and another owner",async()=>{
 localStorage.clear();vi.stubGlobal("navigator",{locks:locks()});const repository=new BrowserRepository();
 const profile=await repository.createProfile({name:"P"}),workspace=await repository.createWorkspace({profileId:profile.id,name:"W",kind:"rv"});
 localStorage.setItem("rvh.dev.providers",JSON.stringify([provider]));
 await repository.replaceProviderModels("pc",[model]);
 const project=await repository.createResearchProject({schemaVersion:1,name:"Study",workspaceId:workspace.id,templateType:"model",sessionLanguage:"en",protocol:createResearchProtocolSelection("full-rcp","en"),targetIds:["t"],repetitions:1,requireUnusedTargets:false,conditions:[{key:"a",label:"A",profileId:profile.id,providerConfigId:provider.id,modelId:"m",requestedSettings:{}}],judges:[{providerConfigId:"pc",modelId:"m"}],randomization:{matchedTargets:true,randomizedExecution:true,randomizedJudgeOrder:true}});
 await repository.lockResearchProject(project.id,{configHash:"frozen",conditions:[],mappings:[],assignments:[{id:"a",researchProjectId:project.id,sessionId:"s",targetId:"t",anonymousSessionId:"BlindSession_ABCDEF12",executionOrder:1,judgeOrder:1,status:"SessionComplete"}]});
 await repository.createRvSession({id:"s",workspaceId:workspace.id,profileId:profile.id,sessionCode:"S",runType:"automatic",researchProjectId:project.id});
 await repository.saveSessionSnapshot("s",{sessionLanguage:"en"} as SessionSnapshot,"hash");
 await repository.sealPreReveal("s","A broad structure.",await sha256Text("A broad structure."));await repository.acceptReveal("s",{source:"automatic_target",text:"A broad tower",artifactManifest:[],hash:"reveal-hash"});
 await repository.setResearchProjectState(project.id,"Judging");await repository.endResearchExecution(project.id);
 const source=await repository.getRvSession("s"),marker=await repository.getResearchExecutionTermination(project.id);
 const panel=await createResearchEvaluation({repository,projectId:project.id});
 await expect(repository.saveResearchEvaluation({...panel,revision:2},1)).rejects.toThrow(/ownership/);
 await repository.withWorkflowOwnership(evaluationScope(project.id),async owned=>{
  await expect(owned.updateRvSessionState("s","Interrupted")).rejects.toThrow(/source work/);
  await expect(owned.saveResearchEvaluation({...panel,revision:2},0)).rejects.toThrow(/revision/);
  await expect(createResearchEvaluation({repository:new BrowserRepository(),projectId:project.id})).rejects.toThrow(/another window/);
 });
 await runResearchEvaluation({repository,projectId:project.id,evaluationId:panel.id,chat:async()=>({content:output,finishReason:"stop",usage:{}})});
 const restarted=new BrowserRepository();expect((await restarted.getResearchEvaluation(project.id,panel.id))?.status).toBe("Complete");
 expect(await restarted.getRvSession("s")).toEqual(source);expect(await restarted.getResearchExecutionTermination(project.id)).toEqual(marker);expect(await restarted.listJudgeScores("s")).toEqual([]);
 expect(localStorage.getItem(evaluationKey(project.id,panel.id))).toContain('"Complete"');
 localStorage.setItem(evaluationKey("other","keep"),JSON.stringify({projectId:"other"}));
 await restarted.archiveResearchProject(project.id);await restarted.purgeResearchProject(project.id);
 expect(localStorage.getItem(evaluationKey(project.id,panel.id))).toBeNull();expect(localStorage.getItem(evaluationKey("other","keep"))).not.toBeNull();
});

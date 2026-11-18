import { targetCodePolicy } from "../resources/rvLiteTargetCode";
import { createResearchProtocolSelection } from "../research/protocolPolicy";
import type { ResearchConfig } from "../research/types";
import { resolveGenerationSettings } from "../providers/capabilities";
import { model,provider } from "./researchJudgeRecoveryFixture";
export { model,provider };
export function targetCodeConfig(language: "pl"|"en"="en"):ResearchConfig {
 const requestedSettings={maxOutputTokens:16384};
 return { schemaVersion:1,name:"Target code",workspaceId:"w",templateType:"target_code",sessionLanguage:language,protocol:createResearchProtocolSelection("rv-lite",language),targetIds:["t"],repetitions:1,requireUnusedTargets:false,
  conditions:(["with_code","without_code"] as const).map(mode=>({key:mode,label:mode,profileId:"p",providerConfigId:provider.id,modelId:model.modelId,requestedSettings:{...requestedSettings},effectiveSettings:resolveGenerationSettings(model.capabilities,requestedSettings,{provider:model.provider}),capabilitySnapshot:structuredClone(model.capabilities),targetCode:targetCodePolicy(mode)})),
  judges:[],evaluationMode:"save_only",randomization:{matchedTargets:true,randomizedExecution:true,randomizedJudgeOrder:true} };
}

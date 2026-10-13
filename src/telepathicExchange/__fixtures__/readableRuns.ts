// Synthetic deterministic test inputs; not used by the application.
import * as packets from "../packets";
import { buildLeadDecisionPacket, guidancePacket } from "../leadGuidance";
import { createTelepathicSeriesState, runNextTelepathicAiRound } from "../engine";
import { lockTelepathicTarget, markTelepathicTargetTransmissionReady } from "../target";
import { withTelepathicTrainingLearning } from "../trainingLearning";
import { sha256Text } from "../../application/sha256";
import { telepathicRequestFingerprint } from "../providerGateway";
import type { ResolvedTelepathicAiRoute } from "../providerGateway";
import type { TelepathicSeriesConfig, TelepathicSeriesState } from "../types";
import type { ProviderModel } from "../../providers/types";

export async function displayFixture(language: "pl" | "en") {
 const ai=(id:string)=>({id,kind:"ai" as const,displayName:id,ai:{profileId:id,profileName:id,workspaceId:"w",aiIdentityId:id,providerConfigId:"c",credentialId:"k",credentialFingerprint:"f",modelId:"m",route:"m"}});
 const config:TelepathicSeriesConfig={schemaVersion:1,seriesId:"display",seriesWorkspaceId:"w",mode:"ai_ai_training",protocolVersion:"fixed_lead_v1",outputBudgetPolicyVersion:2,leadInstructionVersion:"fixed_lead_guidance_v1",maxGuidanceCycles:3,language,participants:[ai("lead"),ai("a")],roundCount:1,topic:"any",discloseTopicToReceivers:false,senderPolicy:{kind:"fixed_ai",participantId:"lead"}};
 const state=createTelepathicSeriesState(config,"2026-10-13T00:00:00.000Z");const round=state.rounds[0];round.status="blind";round.assignment.targetGeography=({"pl": {"areaId": "kenya", "labelPl": "Kenia", "labelEn": "Kenya", "poolVersion": "geography_v1"}, "en": {"areaId": "india", "labelPl": "Indie", "labelEn": "India", "poolVersion": "geography_v1"}})[language];
 round.target=await markTelepathicTargetTransmissionReady(await lockTelepathicTarget(round.assignment.roundId,"lead",{content:"HIDDEN TARGET",assets:[]},"t"),"t");
 round.blindByParticipant.a={participantId:"a",first:"OWN SECRET HISTORY",second:"OWN SECOND HISTORY",status:"sealed",providerAttemptCount:1};
 const scope={language,seriesId:"display",roundId:round.assignment.roundId,participantId:"a",name:"a"};
 const rows:Record<string,packets.TelepathicProviderPacket>={
 target:packets.buildSenderTargetPacket({...scope,participantId:"lead",name:"lead",roundNumber:1,topicLabel:"any",geographyLabel:"AREA"}),
 confirm:packets.buildSenderTransmissionConfirmationPacket({...scope,participantId:"lead",name:"lead"}),
 first:packets.buildReceiverFirstPacket({...scope,roundNumber:1,topicLabel:"any",discloseTopic:false}),
 second:packets.buildReceiverSecondPacket({...scope,ownFirst:"OWN SECRET HISTORY"}),
 receiverReveal:await packets.buildReceiverRevealPacket({...scope,target:round.target,blind:round.blindByParticipant.a,canReadImages:false}),
 missingReveal:await packets.buildReceiverRevealPacket({...scope,target:round.target,blind:{participantId:"a",status:"no_submission",providerAttemptCount:2},canReadImages:false}),
 senderReveal:await packets.buildSenderRevealPacket({...scope,participantId:"lead",name:"lead",target:round.target}),
 consent:packets.buildSharingConsentPacket({...scope,participantNames:["lead","a"]}),
 shared:packets.buildSharedAnswersPacket({...scope,consent:"yes",othersAnswers:"OTHERS SECRET HISTORY"})!,
 final:packets.buildFinalSeriesPacket({...scope,seriesPacket:{schemaVersion:1,seriesId:"display",participantId:"a",rounds:[]} as never}),
 lead:buildLeadDecisionPacket(state,round,1),
 guidance:guidancePacket(state,round,"a","receiver_guidance:cycle:1:recipient:a",`${language === "pl" ? "Odpowiedz tylko nowymi percepcjami. Nie odgaduj celu." : "Respond with only new perceptions. Do not guess the target."}\nOWN_BLIND_DATA: ${JSON.stringify({first:round.blindByParticipant.a.first})}\nLEAD_INSTRUCTION: Describe motion`),
 };
 const participant=config.participants[1];
 for (const [kind,content] of [["fieldGuide","FG PRIVATE LEARNING"],["viewerNotes","VN PRIVATE LEARNING"]] as const) Object.assign(participant,{[kind]:{id:kind,version:"1",content,contentSha256:await sha256Text(content),capturedAt:"t",profileId:"a",aiIdentityId:"a",modelRoute:"m",language}});
 const model={providerConfigId:"c",provider:"custom_openai",modelId:"m",route:"m",capabilities:{contextTokens:64000,maxOutputTokens:32768,inputModalities:["text"],outputModalities:["text"],reasoning:{supported:false,efforts:[],confidence:"unknown"},temperature:{supported:true,min:0,max:2,confidence:"provider_metadata"},supportedParameters:["temperature","max_tokens"],source:"provider",capturedAt:"t"},pricing:{}} as unknown as ProviderModel;
 const route:ResolvedTelepathicAiRoute={snapshot:participant.ai!,model,providerConfig:{id:"c",provider:"custom_openai",credentialId:"k",baseUrl:"https://example.test/v1",enabled:true} as never,requestedSettings:{temperature:0.5,maxOutputTokens:16384},validatedIdentity:{profileId:"a",workspaceId:"w",aiIdentityId:"a",credentialFingerprint:"f"}};
 const snapshot:Record<string,unknown>={};
 for (const [key,p] of Object.entries(rows)) {
  const learned=await withTelepathicTrainingLearning({packet:p,participant,language});
  snapshot[key]={messages:packets.composeTelepathicProviderMessages(learned),requestSha256:await telepathicRequestFingerprint(learned,route,true)};
 }
 return {state,rows,snapshot,participant,route};
}

export async function actualDisplayRun(language:"pl"|"en", run=runNextTelepathicAiRound, create=createTelepathicSeriesState) {
 const x=await displayFixture(language);const state=create({...x.state.config,participants:x.state.config.participants.map(p=>p.id === "a" ? x.participant : p)},"2026-10-13T00:00:00.000Z");state.rounds[0].assignment.targetGeography=x.state.rounds[0].assignment.targetGeography;state.plan.rounds[0].targetGeography=x.state.rounds[0].assignment.targetGeography;
 const {InMemoryTelepathicExchangeStore}=await import("../store");const store=new InMemoryTelepathicExchangeStore();await store.saveTelepathicSeries(state);
 const requests:unknown[]=[];
 const result=await run({store,now:()=>"2026-10-13T00:00:00.000Z",resolveRoute:async participant=>({...x.route,snapshot:participant.ai!,validatedIdentity:{profileId:participant.ai!.profileId,workspaceId:"w",aiIdentityId:participant.ai!.aiIdentityId,credentialFingerprint:"f"}}),providerAttempt:async request=>{
  requests.push({messages:request.messages,settings:request.settings,modelId:request.modelId});const text=request.messages.map(m=>m.content).join("\n");
  const content=text.includes("CONTRACT:")?JSON.stringify({cycle:Number(text.match(/"cycle":(\d)/)?.[1]),finishRound:Number(text.match(/"cycle":(\d)/)?.[1])>1,finishParticipantIds:[],...(Number(text.match(/"cycle":(\d)/)?.[1])===1?{broadcast:{recipientIds:["a"],instruction:"Describe motion"}}:{})}):text.includes("Odpowiedz TAK albo NIE")||text.includes("Reply YES or NO")?"NO":"ACTUAL MODEL ANSWER with notes and system words";
  return {content,finishReason:"stop",usage:{totalTokens:12}};
 }},"display");
 return {result,requests,calls:result.providerCalls.map(({scopeKey,status,technicalAttempt,requestSha256,requestMessages,requestSettings,outputBudgetSnapshot})=>({scopeKey,status,technicalAttempt,requestSha256,requestMessages,requestSettings,outputBudgetSnapshot}))};
}

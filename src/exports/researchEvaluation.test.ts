import { expect, it, vi } from "vitest";
import { evaluationFixture } from "../testing/researchEvaluationFixture";
import { model, output } from "../testing/researchJudgeRecoveryFixture";
const mocks=vi.hoisted(()=>({write:vi.fn(async()=>"/exports/panel")}));
vi.mock("./native",()=>({writeExportPackage:mocks.write}));
import { exportResearchEvaluation } from "./researchEvaluation";
it("exports two panels separately and never exposes source conditions or credential references in anonymous score files",async()=>{
 const f=evaluationFixture(),a=await f.create();await f.run(a.id);const b=await f.create();await f.run(b.id);
 await exportResearchEvaluation(f.repo,"r",a.id);await exportResearchEvaluation(f.repo,"r",b.id);
 const requests=mocks.write.mock.calls as unknown as Array<[{files:Array<{relativePath:string;content:string}>}]>;
 const pa=JSON.parse(requests.at(-2)![0].files.find(file=>file.relativePath==="evaluation/scores.json")!.content),pb=JSON.parse(requests.at(-1)![0].files.find(file=>file.relativePath==="evaluation/scores.json")!.content);
 expect(pa.evaluationId).toBe(a.id);expect(pb.evaluationId).toBe(b.id);expect(pa.sessions[0].scores).toHaveLength(1);expect(pb.sessions[0].scores).toHaveLength(1);
 expect(pa).toHaveProperty("results");expect(pa.partial).toBe(false);
 const publicContent=requests.at(-1)![0].files.filter(file=>file.relativePath.startsWith("evaluation/")).map(file=>file.content).join("\n");
 expect(publicContent).not.toContain("credentialId");expect(publicContent).not.toContain("conditions");expect(publicContent).not.toContain("sourceSha256Missing");
 expect(requests.at(-1)![0].files.find(file=>file.relativePath==="private_master/evaluation_record.json")?.content).toContain('"credentialId"');
});
it("partial panel export has its own score count and no final aggregate",async()=>{
 const f=evaluationFixture(),p=await f.create([{providerConfigId:"pc",modelId:"m"},{providerConfigId:"pc",modelId:"m"}]);f.chat.mockResolvedValueOnce({content:JSON.stringify({...JSON.parse(output),strongestMatches:null}),finishReason:"stop",usage:{}});await f.run(p.id);
 await exportResearchEvaluation(f.repo,"r",p.id);
 const request=(mocks.write.mock.calls.at(-1) as unknown as [{files:Array<{relativePath:string;content:string}>}])[0];
 const view=JSON.parse(request.files.find(file=>file.relativePath==="evaluation/scores.json")!.content);
 expect(view).toMatchObject({partial:true,received:1,expected:2});expect(view).not.toHaveProperty("results");
 expect(request.files.find(file=>file.relativePath==="README.md")?.content).toContain("Partial scores");
});

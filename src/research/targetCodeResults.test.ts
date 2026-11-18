import { it,expect } from "vitest";
import { targetCodeResultsFixture } from "../testing/targetCodeResultsFixture";
import { computeTargetCodeComparison,targetCodeComparisonCsv } from "./targetCodeResults";
it("compares only complete scored pairs and keeps all-session means separate",async()=>{
 const input=await targetCodeResultsFixture(),result=computeTargetCodeComparison(input);
 expect(result.pairs.map(p=>p.winner)).toEqual(["A","B","tie","missing"]);
 expect(result.pairs.map(p=>p.difference)).toEqual([2,-4,0,undefined]);
 expect(result.summary).toMatchObject({completePairs:3,missingPairs:1,winsA:1,winsB:1,ties:1,scoredA:4,scoredB:3,meanA:7});
 expect(result.summary.meanB).toBeCloseTo(20/3);expect(result.summary.meanPairedDifference).toBeCloseTo(-2/3);
 expect(result.pairs[3].b?.aggregate).toBeUndefined();expect(result.pairs[3].b?.scores).toHaveLength(1);
 const csv=targetCodeComparisonCsv(result);expect(csv).toContain('"RV-1-A","8","RV-1-B","6","2","A"');expect(csv).toContain('"RV-4-B","","","missing"');
 const restored=JSON.parse(JSON.stringify(result));expect(restored.pairs[3].difference).toBeUndefined();
});
it("save_only and interrupted sessions never fabricate zero scores or a winner",async()=>{
 const input=await targetCodeResultsFixture();let result=computeTargetCodeComparison({...input,requiredJudges:0,scoresBySession:{}});
 expect(result.summary).toMatchObject({completePairs:0,missingPairs:4,winsA:0,winsB:0,ties:0,scoredA:0,scoredB:0});expect(result.summary.meanA).toBeUndefined();expect(result.summary.meanPairedDifference).toBeUndefined();
 input.sessions[0].state="Interrupted";result=computeTargetCodeComparison(input);expect(result.pairs[0].winner).toBe("missing");
});

import { describe,it,expect } from "vitest";
import { getRvLite, renderRvLiteSteps } from "./protocolRegistry";
import { renderResearchTargetCodeSteps,targetCodePolicy,targetCodeSteps,verifyTargetCodeTemplates } from "./rvLiteTargetCode";

describe("frozen target-code renderer",()=>{
  it("matches the pinned experimental resource hash",async()=>{await verifyTargetCodeTemplates();});
  it.each(["pl","en"] as const)("changes only two approved places in %s; A remains byte-identical",language=>{
    const p=getRvLite(language,"extended"), old=renderRvLiteSteps(p,"Leo","RV-SECRET-7");
    const a=renderResearchTargetCodeSteps(p,"Leo","RV-SECRET-7",targetCodePolicy("with_code"));
    const b=renderResearchTargetCodeSteps(p,"Leo","RV-SECRET-7",targetCodePolicy("without_code"));
    expect(a).toEqual(old);expect(b).toHaveLength(4);expect(b.slice(2)).toEqual(old.slice(2));
    expect(b[0]).toBe(old[0].replace(language==="pl"?"Nie rozpoczynaj sesji, dopóki nie otrzymasz kodu sesji.":"Do not begin the session until you receive the session code.",language==="pl"?"Nie rozpoczynaj sesji, dopóki nie otrzymasz polecenia rozpoczęcia.":"Do not begin the session until you receive the instruction to begin."));
    expect(b[1]).toBe(language==="pl"?"Witaj. Cel został wybrany. Rozpocznij sesję.\n\nCelu nie nazywamy — tylko go opisujemy.\n\nWykonaj Krok 1 i Krok 2.":"Hello. The target has been selected. Begin the session.\n\nDo not name the target. Describe it only.\n\nPerform Step 1 and Step 2.");
    expect(b.join("\n")).not.toMatch(/RV-SECRET-7|\{\{|without_code|with_code|target-code-presence|A\/B/);
    expect(p.contentSha256).toHaveLength(64);
  });
  it("fails closed for source drift, duplicate replacement, unknown modes and hashes",()=>{
    const p=getRvLite("en","extended"),policy=targetCodePolicy("without_code");
    expect(()=>targetCodeSteps([p.steps[0]+p.steps[0],...p.steps.slice(1)] as [string,string,string,string],"en",policy)).toThrow(/exactly once/);
    expect(()=>targetCodeSteps([p.steps[0],"changed",p.steps[2],p.steps[3]],"en",policy)).toThrow();
    for(const patch of [{mode:"unknown"},{version:"v99"},{templatesSha256:"x"}])expect(()=>targetCodeSteps(p.steps,"en",{...policy,...patch} as never)).toThrow(/mismatch/);
  });
});

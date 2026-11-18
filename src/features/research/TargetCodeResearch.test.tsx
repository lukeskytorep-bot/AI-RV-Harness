import { renderToStaticMarkup } from "react-dom/server";
import { it,expect } from "vitest";
import { TargetCodePreview,TargetCodeResultsView } from "./TargetCodeResearch";
import { computeTargetCodeComparison } from "../../research/targetCodeResults";
import { targetCodeResultsFixture } from "../../testing/targetCodeResultsFixture";
import type { AppRepository } from "../../storage/repository";
it.each(["pl","en"] as const)("shows four real prompt previews and explicit pair scores/components in %s",async language=>{
 const preview=renderToStaticMarkup(<TargetCodePreview language={language} name="Leo"/>);
 expect(preview.match(/Prompt [1-4]/g)).toHaveLength(8);expect(preview).toContain("RV-PREVIEW-0001");
 expect(preview).toContain(language==="pl"?"Cel został wybrany. Rozpocznij sesję.":"The target has been selected. Begin the session.");
 const comparison=computeTargetCodeComparison(await targetCodeResultsFixture());
 const html=renderToStaticMarkup(<TargetCodeResultsView comparison={comparison} repository={{} as AppRepository} language={language}/>);
 for(let i=1;i<=4;i++){expect(html).toContain(`RV-${i}-A`);expect(html).toContain(`RV-${i}-B`);}
 expect(html).toContain("J1: 8/10");expect(html).toContain("J2: 8/10");expect(html).toContain("3/3 + 3/3 + 1/2 + 1/2");
 expect(html).toContain(language==="pl"?"Brak pełnej pary":"Incomplete pair");expect(html).toContain("-0.67");
});

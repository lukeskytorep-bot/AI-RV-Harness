import { isTauriRuntime } from "../storage";
import { chooseDirectory } from "../storage/native";
import { writeExportPackage } from "./native";
import { telepathicExportDocument } from "../telepathicExchange/export";
import type { TelepathicSeriesState } from "../telepathicExchange/types";

/** Uses the same role-safe transcript projection as the live view. */
export async function saveTelepathicDocument(state:TelepathicSeriesState):Promise<void> {
  const content=telepathicExportDocument(state);
  const filename=`telepathy-${state.config.seriesId.replace(/[^a-zA-Z0-9_-]/g,"_")}.md`;
  if(isTauriRuntime()) {
    const directory=await chooseDirectory(state.config.language==="pl"?"Zapisz serię telepatyczną":"Save telepathic series");
    if(!directory)return;
    const human=state.config.participants.find(p=>p.kind==="human");
    const artifactCopies=state.rounds.filter(round=>round.revealedAt||!human||round.assignment.senderParticipantId===human.id).flatMap(round=>(round.target?.assets??[]).filter(asset=>asset.path).map(asset=>({sourcePath:asset.path!,relativePath:`assets/round-${round.assignment.roundNumber}-${asset.artifactId.replace(/[^a-zA-Z0-9_-]/g,"_")}-${asset.originalFileName.replace(/[^a-zA-Z0-9._-]/g,"_")}`})));
    const links=artifactCopies.map(asset=>`- [${asset.relativePath}](${asset.relativePath})`).join("\n");
    await writeExportPackage({exportId:`telepathy-${crypto.randomUUID()}`,destination:"external",baseDirectory:directory,files:[{relativePath:filename,content:content+(links?`\n\n## ${state.config.language==="pl"?"Załączniki":"Attachments"}\n\n${links}`:"")}],artifactCopies});
    return;
  }
  const blob=new Blob([content],{type:"text/markdown;charset=utf-8"});
  const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),0);
}

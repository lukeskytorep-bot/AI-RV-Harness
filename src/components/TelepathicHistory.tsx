import { Archive, Download, FolderOpen, ChevronRight, ChevronLeft, RotateCcw } from "lucide-react";
import { TooltipButton } from "./TooltipButton";
import { useState } from "react";
interface Item { id:string;name:string;updatedAt:string;status:string;archivedAt?:string; }
interface Props { sessionKind?: "training" | "exchange"; items:Item[];pl:boolean;busy:boolean;onOpen(id:string):void;onSave(id:string):void;onArchive(id:string,archived:boolean):void; }
export function TelepathicHistory({items,pl,busy,onOpen,onSave,onArchive,sessionKind="training"}:Props) {
  const noun = sessionKind === "exchange" ? (pl?"wymianę":"exchange") : (pl?"trening":"training");
  const [open,setOpen]=useState(true);const [archived,setArchived]=useState(false);
  return <aside className={`telepathic-history ${open?"":"collapsed"}`}>
    <TooltipButton className="telepathic-history-toggle" ariaExpanded={open} label={pl?(open?"Zwiń historię":"Rozwiń historię"):(open?"Collapse history":"Expand history")} onClick={()=>setOpen(!open)}>{open?<ChevronRight size={16}/>:<ChevronLeft size={16}/>}</TooltipButton>
    {open&&<><h3>{pl?"Historia telepatii":"Telepathy history"}</h3><label><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)}/>{pl?"Archiwum":"Archive"}</label>
      <div className="telepathic-history-list">{items.filter(i=>Boolean(i.archivedAt)===archived).map(i=><article className="telepathic-history-card" key={i.id}>
        <div className="telepathic-history-row"><span>{i.name}<small>{new Date(i.updatedAt).toLocaleString()} · {i.status}</small></span>
          <div className="telepathic-history-icons">
            {([{label:`${pl?"Otwórz":"Open"} ${noun}`,Icon:FolderOpen,action:()=>onOpen(i.id)},
              {label:`${pl?"Zapisz":"Save"} ${noun}`,Icon:Download,action:()=>onSave(i.id)},
              {label:i.archivedAt?(`${pl?"Przywróć":"Restore"} ${noun}`):(`${pl?"Archiwizuj":"Archive"} ${noun}`),Icon:i.archivedAt?RotateCcw:Archive,action:()=>onArchive(i.id,!i.archivedAt)}]).map(({label,Icon,action})=><TooltipButton className="telepathic-icon-button" key={label} label={label} disabled={busy} onClick={action}><Icon size={15}/></TooltipButton>)}
          </div>
        </div>
      </article>)}</div>
    </>}
  </aside>;
}

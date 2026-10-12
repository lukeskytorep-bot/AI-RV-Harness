import { Archive, Database, Download, FolderOpen, RotateCcw } from "lucide-react";
import { useId, useState } from "react";
import { HistoryPanelShell } from "./HistoryPanelShell";
import { TooltipButton } from "./TooltipButton";

interface Item { id: string; name: string; updatedAt: string; status: string; archivedAt?: string; }
interface Props {
  sessionKind?: "training" | "exchange";
  items: Item[];
  pl: boolean;
  busy: boolean;
  onOpen(id: string): void;
  onSave(id: string): void;
  onArchive(id: string, archived: boolean): void;
}

export function TelepathicHistory({ items, pl, busy, onOpen, onSave, onArchive, sessionKind = "training" }: Props) {
  const noun = sessionKind === "exchange" ? (pl ? "wymianę" : "exchange") : (pl ? "trening" : "training");
  const [open, setOpen] = useState(true);
  const panelId = useId();
  return <HistoryPanelShell open={open} onToggle={() => setOpen(current => !current)} panelId={panelId}
    label={pl ? (open ? "Zwiń historię" : "Rozwiń historię") : (open ? "Collapse history" : "Expand history")}
    className="telepathic-history" toggleClassName="telepathic-history-toggle" panelClassName="telepathic-history-panel">
    <div className="panel-header"><span><Database size={18} aria-hidden="true" /></span><h2>{pl ? "Historia telepatii" : "Telepathy history"}</h2></div>
    <div className="training-run-list telepathic-history-list">{items.map(item => <article className="telepathic-history-card" key={item.id}>
      <div className="training-run-header telepathic-history-row">
        <span className="training-history-title">{item.name}</span>
        <div className="training-run-icon-actions telepathic-history-icons">
          <TooltipButton className="icon-button" label={`${pl ? "Otwórz" : "Open"} ${noun}`} disabled={busy} onClick={() => onOpen(item.id)}><FolderOpen size={14} aria-hidden="true" /></TooltipButton>
          <TooltipButton className="icon-button" label={`${pl ? "Zapisz" : "Save"} ${noun}`} disabled={busy} onClick={() => onSave(item.id)}><Download size={14} aria-hidden="true" /></TooltipButton>
          <TooltipButton className="icon-button" label={`${item.archivedAt ? (pl ? "Przywróć" : "Restore") : (pl ? "Archiwizuj" : "Archive")} ${noun}`}
            disabled={busy} onClick={() => onArchive(item.id, !item.archivedAt)}>
            {item.archivedAt ? <RotateCcw size={14} aria-hidden="true" /> : <Archive size={14} aria-hidden="true" />}
          </TooltipButton>
        </div>
      </div>
      <div className="training-run-details"><small><time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString()}</time> · {item.status}</small>
        {item.archivedAt && <small className="telepathic-history-archived">{pl ? "Zarchiwizowano" : "Archived"}</small>}
      </div>
    </article>)}</div>
    {!items.length && <p className="recent-session-empty">{pl ? "Brak zapisanych sesji." : "No saved sessions."}</p>}
  </HistoryPanelShell>;
}

import { CircleStop, Play } from "lucide-react";
interface Props { pl: boolean; busy: boolean; stopping: boolean; unavailable: boolean; recovery: boolean; uncertain: boolean; resumeBlocked?: boolean; resumeReason?: string; onStop(): void; onResume(): void; onEnd(): void; }
export function TelepathicSeriesActions(p: Props) {
  return <div className="telepathic-series-actions">
    {p.busy || !p.recovery ? <button type="button" className="stop-button compact-telepathic-button" disabled={!p.busy || p.stopping || p.unavailable} onClick={p.onStop} title={p.pl ? "Zatrzymuje teraz i zachowuje postęp. Wznowienie wymaga Twojej decyzji." : "Stops now and saves progress. Resume requires your action."}><CircleStop size={15}/>{p.stopping ? (p.pl ? "Zatrzymywanie…" : "Stopping…") : "Stop"}</button> : <>
      <button type="button" className="secondary-button compact-telepathic-button" disabled={p.unavailable || (p.resumeBlocked ?? p.uncertain)} onClick={p.onResume} title={p.resumeReason ?? (p.uncertain ? (p.pl ? "Najpierw rozstrzygnij niepewne wywołanie." : "Resolve the uncertain call first.") : undefined)}><Play size={15}/>{p.pl ? "Wznów" : "Resume"}</button>
      <button type="button" className="secondary-button compact-telepathic-button" disabled={p.unavailable} onClick={p.onEnd} title={p.pl ? "Kończy tę serię bez wznowienia. Zapisane wyniki pozostaną." : "Ends this series without resuming it. Saved results are retained."}><CircleStop size={15}/>{p.pl ? "Zakończ" : "End"}</button>
    </>}
    {p.recovery && p.resumeReason && <small role="status">{p.resumeReason}</small>}
  </div>;
}

import { ChevronRight } from "lucide-react";
import type { InterfaceLanguage } from "../../types";
import { sessionFocusLabel, type SessionFocus, type SessionFocusPlan } from "../../sessions/sessionFocus";

export function SessionFocusControls({value,onChange,language,disabled}:{value?:SessionFocusPlan;onChange:(value:SessionFocusPlan|undefined)=>void;language:InterfaceLanguage;disabled:boolean}) {
 const pl=language==="pl";
 const options=(["location","activity","event"] as const).map(focus=><option key={focus} value={focus}>{sessionFocusLabel(focus,language)}</option>);
 return <details className="special-task-disclosure session-focus-disclosure">
  <summary><span><strong>{pl?"Ukierunkowanie sesji — opcjonalne":"Session focus — optional"}</strong><small>{value?`${value.second?2:1} ${pl?(value.second?"sesje":"sesja"):(value.second?"sessions":"session")}: ${sessionFocusLabel(value.first,language)}${value.second?` → ${sessionFocusLabel(value.second,language)}`:""}`:(pl?"Rozwiń, aby ustawić":"Expand to configure")}</small></span><ChevronRight size={15}/></summary>
  <div className="special-task-builder">
   <p>{pl?"Opcjonalnie wskaż, na czym Viewer ma skupić sesję: lokalizacji, aktywności lub wydarzeniu. Wskazówka zostanie podana tylko na początku. Wybranie drugiego pola uruchomi kolejną pełną sesję do tego samego celu. Cel zostanie ujawniony dopiero po zakończeniu obu sesji. Bez wyboru sesja działa jak dotychczas.":"Optionally choose a focus for the Viewer: location, activity, or event. The cue is supplied only at the beginning. Selecting the second field starts another complete session for the same target. The target is revealed only after both sessions are finished. Without a selection, the session runs as usual."}</p>
   <label><span>{pl?"Sesja 1":"Session 1"}</span><select aria-label={pl?"Sesja 1":"Session 1"} value={value?.first??""} disabled={disabled} onChange={event=>onChange(event.target.value?{version:1,first:event.target.value as SessionFocus,...(value?.second?{second:value.second}:{})}:undefined)}><option value="">{pl?"Bez ukierunkowania":"No focus"}</option>{options}</select></label>
   <label><span>{pl?"Sesja 2 — opcjonalna":"Session 2 — optional"}</span><select aria-label={pl?"Sesja 2 — opcjonalna":"Session 2 — optional"} value={value?.second??""} disabled={disabled||!value} onChange={event=>{if(value)onChange({version:1,first:value.first,...(event.target.value?{second:event.target.value as SessionFocus}:{})});}}><option value="">{pl?"Nie wykonuj drugiej sesji":"No second session"}</option>{options}</select></label>
  </div>
 </details>;
}

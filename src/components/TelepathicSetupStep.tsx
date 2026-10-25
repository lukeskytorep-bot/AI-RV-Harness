import { Check, Pencil } from "lucide-react";
import type { ReactNode } from "react";
import { TooltipButton } from "./TooltipButton";

/** Local setup only: confirmation never edits a persisted series. */
export function TelepathicSetupStep({ step, pl, enabled = true, valid, confirmed, busy, onConfirm, onEdit, children }: {
  step: 1 | 2; pl: boolean; enabled?: boolean; valid: boolean; confirmed: boolean; busy: boolean;
  onConfirm(): void; onEdit(): void; children: ReactNode;
}) {
  const title = step === 1
    ? (pl ? "Krok 1 — Uczestnicy, w tym prowadzący" : "Step 1 — Participants, including the lead")
    : (pl ? "Krok 2 — Prowadzący" : "Step 2 — Lead");
  const action = step === 1
    ? (confirmed ? (pl ? "Zmień uczestników" : "Change participants") : (pl ? "Zatwierdź uczestników" : "Confirm participants"))
    : (confirmed ? (pl ? "Zmień prowadzącego" : "Change lead") : (pl ? "Zatwierdź prowadzącego" : "Confirm lead"));
  return <section className="panel telepathic-exchange-panel telepathic-setup-step" data-setup-step={step}>
    <h3>{title}</h3>
    <fieldset className="telepathic-setup-fields" disabled={busy || !enabled || confirmed} aria-label={title}>{children}</fieldset>
    {!enabled && <p>{pl ? "Najpierw zatwierdź uczestników." : "Confirm participants first."}</p>}
    <div className="training-actions"><TooltipButton className="secondary-button" label={action}
      disabled={busy || !enabled || (!confirmed && !valid)} onClick={confirmed ? onEdit : onConfirm}>
      {confirmed ? <Pencil size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}{action}
    </TooltipButton>{confirmed && <span role="status">{pl ? "Zatwierdzono" : "Confirmed"}</span>}</div>
  </section>;
}

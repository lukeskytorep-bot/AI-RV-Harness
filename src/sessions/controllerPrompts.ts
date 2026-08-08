import type { InterfaceLanguage } from "../types";

export const RCP_CONTROLLER_PROMPT_ID = "full-rcp-phase-controller";
export const RCP_CONTROLLER_PROMPT_VERSION = "1.0.0";

export function rcpPhasePrompt(language: InterfaceLanguage, phase: number, sessionCode: string): string {
  if (phase < 1 || phase > 6) throw new Error("RCP phase must be between 1 and 6.");
  if (language === "pl") {
    if (phase === 6) {
      return `ŚLEPY KOD CELU: ${sessionCode}\nWykonaj teraz Fazę 6 dokładnie tak, jak zdefiniowano ją w dołączonym zasobie protokołu RCP. Nie korzystaj z żadnego revealu ani wiedzy o prawdziwym celu.`;
    }
    return `ŚLEPY KOD CELU: ${sessionCode}\nWykonaj teraz wyłącznie Fazę ${phase}, dokładnie tak, jak zdefiniowano ją w dołączonym zasobie protokołu RCP. Zapisz dane tej fazy i nie przechodź do następnej numerowanej fazy, dopóki Protocol Controller jej nie uruchomi.`;
  }
  if (phase === 6) {
    return `BLIND TARGET CODE: ${sessionCode}\nNow execute Phase 6 exactly as defined in the attached RCP protocol resource. Do not use any reveal or knowledge of the true target.`;
  }
  return `BLIND TARGET CODE: ${sessionCode}\nNow execute Phase ${phase} only, exactly as defined in the attached RCP protocol resource. Record this phase's data and do not advance to the next numbered phase until the Protocol Controller starts it.`;
}

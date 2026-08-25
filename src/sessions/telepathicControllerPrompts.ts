import type { InterfaceLanguage } from "../types";

export const TELEPATHIC_CONTROLLER_PROMPT_ID = "telepathic-nine-step-controller";
export const TELEPATHIC_CONTROLLER_PROMPT_VERSION = "1.0.0";

export const TELEPATHIC_STEP_MAPPING = [
  { controllerStep: 1, protocolSections: ["T0", "T1"] },
  { controllerStep: 2, protocolSections: ["T2"] },
  { controllerStep: 3, protocolSections: ["T3"] },
  { controllerStep: 4, protocolSections: ["T4"] },
  { controllerStep: 5, protocolSections: ["T5"] },
  { controllerStep: 6, protocolSections: ["T6"] },
  { controllerStep: 7, protocolSections: ["T7"] },
  { controllerStep: 8, protocolSections: ["T8", "T9"] },
  { controllerStep: 9, protocolSections: ["T10"] },
] as const;

const stepMappings = {
  pl: [
    "T0 (Reset telepatyczny), a następnie T1 (DOTYK AI 3x)",
    "T2 (szybki kontakt, obieg wektorów i szkic funkcjonalny)",
    "T3 (Podmiot: opis podstawowy i kontekst)",
    "T4 (Deep Mind Probe — stan wewnętrzny podmiotu)",
    "T5 (Body Condition Probe — stan fizyczny podmiotu)",
    "T6 (Relacje z innymi)",
    "T7 (Profil liczbowy)",
    "T8 (Świadomość Viewera i Light Up)",
    "T10 (Podsumowanie telepatyczne)",
  ],
  en: [
    "T0 (Telepathic Reset), followed by T1 (AI Touch 3×)",
    "T2 (rapid contact, vector orbit, and functional sketch)",
    "T3 (Subject: Basic Description and Context)",
    "T4 (Deep Mind Probe — internal state of the subject)",
    "T5 (Body Condition Probe — physical state of the subject)",
    "T6 (Relationships with Others)",
    "T7 (Numerical Profile)",
    "T8 (Viewer Awareness and Light Up)",
    "T10 (Telepathic Summary)",
  ],
} as const;

export function telepathicStepPrompt(language: InterfaceLanguage, step: number, sessionCode: string): string {
  if (step < 1 || step > 9) throw new RangeError("Telepathic controller step must be between 1 and 9.");
  const mapping = stepMappings[language][step - 1];
  if (language === "pl") {
    const sketch = step === 1
      ? " Gdy protokół wymaga rysunku lub szkicu, zawsze wykonaj go również jako tekstowy szkic ASCII w bloku kodu, z etykietami bezpośrednio przy elementach."
      : "";
    return `ŚLEPY KOD CELU: ${sessionCode}\nWykonaj teraz wyłącznie Krok ${step} kontrolera: ${mapping}, dokładnie według dołączonego Protokołu Telepatycznego. Pozostań w Strefie Cienia, zapisuj RAW oddzielnie od D/VF i nie przechodź do kolejnego kroku kontrolera.${sketch}`;
  }
  const sketch = step === 1
    ? " Whenever the protocol requires a drawing or sketch, also render it as a text-based ASCII sketch inside a fenced code block, with labels placed directly beside the elements."
    : "";
  return `BLIND TARGET CODE: ${sessionCode}\nNow execute only Controller Step ${step}: ${mapping}, exactly as defined in the attached Telepathic Protocol. Remain in Shadow Zone, keep RAW separate from D/VF, and do not advance to the next controller step.${sketch}`;
}

export function telepathicFixedDeepeningPrompt(language: InterfaceLanguage, step: 3 | 4 | 5): string {
  if (language === "pl") {
    return `Wróć teraz wyłącznie do Kroku ${step}. Wejdź jeszcze głębiej w dane tego kroku, przyjrzyj się im dokładniej i opisz nowe szczegóły oraz detale. Nie przechodź do kolejnego kroku i nie powtarzaj danych już podanych wystarczająco.`;
  }
  return `Return now only to Step ${step}. Go deeper into this step's data, examine it more closely, and report new details. Do not advance to the next step or unnecessarily repeat data already reported adequately.`;
}

export function telepathicQuestionPrompt(language: InterfaceLanguage, question: string, questionNumber: number): string {
  const clean = question.trim();
  if (!clean) throw new Error("A telepathic tasking question cannot be empty.");
  if (language === "pl") {
    return `T9 — pytanie taskingu ${questionNumber}: ${clean}\nOdpowiedz na to pytanie na podstawie całej dotychczasowej ślepej sesji i bieżącego kontaktu z podmiotem. Zachowaj rozdzielenie RAW, D i VF. Nie przechodź jeszcze do podsumowania T10.`;
  }
  return `T9 — tasking question ${questionNumber}: ${clean}\nAnswer this question using the whole blind session gathered so far and the current contact with the subject. Keep RAW, D, and VF separate. Do not advance to the T10 summary yet.`;
}

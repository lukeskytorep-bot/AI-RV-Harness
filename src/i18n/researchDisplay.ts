import type { InterfaceLanguage } from "../types";
import type { ResearchTemplateType } from "../research/types";

/** Display only: never use this label to build or hash a research configuration. */
export function researchConditionDisplayLabel(language: InterfaceLanguage, template: ResearchTemplateType, key: string, storedLabel: string): string {
  const pl = language === "pl";
  if (template === "practice") {
    if (key === "first") return pl ? "PIERWSZA" : "FIRST";
    if (key === "second") return pl ? "DRUGA" : "SECOND";
  }
  if (template === "viewer_notes") {
    if (key === "no_notes") return pl ? "Bez notatek" : "No Notes";
    if (key === "frozen_notes") {
      const version = / v(\d+)$/.exec(storedLabel)?.[0] ?? "";
      return `${pl ? "Zamrożone notatki" : "Frozen Notes"}${version}`;
    }
  }
  return storedLabel;
}

const assignmentLabels: Record<string, readonly [string, string]> = {
  Pending: ["Oczekuje", "Pending"],
  Initializing: ["Inicjalizacja", "Initializing"],
  Running: ["W trakcie", "Running"],
  Interrupted: ["Przerwana", "Interrupted"],
  ResumeApproved: ["Wznowienie zatwierdzone", "Resume approved"],
  RestartApproved: ["Ponowne rozpoczęcie zatwierdzone", "Restart approved"],
  SessionComplete: ["Sesja ukończona", "Session complete"],
  Judged: ["Oceniona", "Judged"],
};

export function researchAssignmentDisplayStatus(language: InterfaceLanguage, status: string): string {
  return Object.prototype.hasOwnProperty.call(assignmentLabels, status)
    ? assignmentLabels[status][language === "pl" ? 0 : 1]
    : status;
}

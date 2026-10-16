import { LEGACY_LEAD_INSTRUCTION_VERSION, type LeadGuidanceVersion, validateLeadDecision } from "./leadGuidance";
import type { StoredLeadGuidanceDecision, TelepathicRoundState } from "./types";

const reasons = {
  invalid_json: ["Niepoprawny JSON lub opakowanie odpowiedzi.", "Invalid JSON or response wrapper."],
  invalid_object: ["Decyzja musi być obiektem JSON.", "The decision must be a JSON object."],
  invalid_cycle: ["Cykl nie odpowiada wysłanemu pytaniu.", "The cycle does not match the request."],
  invalid_header: ["Niepoprawne pola nagłówka decyzji.", "Invalid decision header fields."],
  unknown_field: ["Niedozwolone pole decyzji: użyj wyłącznie listy individual.", "Unknown decision field: only individual instructions are allowed."],
  missing_receiver: ["Każdy aktywny Viewer musi otrzymać instrukcję albo jawne zakończenie udziału.", "Each active Viewer needs an instruction or an explicit finish."],
  invalid_receivers: ["Nieznany, zakończony lub powtórzony odbiorca.", "Unknown, finished or duplicate receiver."],
  invalid_instruction: ["Niepoprawna treść lub lista instrukcji.", "Invalid instruction content or list."],
  finished_round: ["Zakończona runda nie może wysyłać pytań.", "A finished round cannot dispatch questions."],
  no_action: ["Brak jawnej instrukcji lub zakończenia.", "No explicit instruction or finish action."],
  target_leak: ["Instrukcja zawiera ukryty cel lub geografię.", "The instruction contains a hidden target or geography term."],
  invalid_decision: ["Decyzja nie spełnia kontraktu.", "The decision does not meet the contract."],
} as const;
type Reason = keyof typeof reasons;
const prefix = "Invalid lead decision; no questions were invented or dispatched.";

function rejected(reason: Reason, cause: unknown): Error {
  return new Error(`${prefix} [${reason}] ${reasons[reason][1]}`, { cause });
}

/** Normalize only an entire, unambiguous wrapper. Never modify the saved evidence. */
export function parseLeadDecisionResponse(text: string, round: TelepathicRoundState, cycle: 1 | 2 | 3, version: LeadGuidanceVersion = LEGACY_LEAD_INSTRUCTION_VERSION): StoredLeadGuidanceDecision {
  const trimmed = text.trim(); // Includes BOM, spaces and surrounding newlines.
  const fence = /^```(?:json)?[\t ]*\r?\n([\s\S]*?)\r?\n[\t ]*```$/i.exec(trimmed);
  let raw: unknown;
  try { raw = JSON.parse(fence ? fence[1] : trimmed); }
  catch (cause) { throw rejected("invalid_json", cause); }
  try {
    return validateLeadDecision(raw, cycle,
      round.assignment.receiverParticipantIds.filter(id => !round.guidance?.finishedParticipantIds.includes(id)),
      [round.target?.content ?? "", round.assignment.targetGeography?.labelPl ?? "", round.assignment.targetGeography?.labelEn ?? ""], version);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    const reason: Reason = message === "Lead decision must be a JSON object." ? "invalid_object"
      : message === "Invalid lead decision header." ? (raw && typeof raw === "object" && "cycle" in raw && raw.cycle !== cycle ? "invalid_cycle" : "invalid_header")
      : /Unknown lead decision field/.test(message) ? "unknown_field"
      : /Each active receiver/.test(message) ? "missing_receiver"
      : /receiver|receiver IDs/.test(message) ? "invalid_receivers"
      : /hidden target/.test(message) ? "target_leak"
      : /finished round/.test(message) ? "finished_round"
      : /explicit action/.test(message) ? "no_action"
      : /broadcast|individual instruction|non-empty instruction/.test(message) ? "invalid_instruction" : "invalid_decision";
    throw rejected(reason, cause);
  }
}

/** Stable codes in durable errors; no raw model output is echoed into the banner. */
export function leadDecisionErrorMessage(message: string, pl: boolean): string {
  if (!message.startsWith("Invalid lead decision")) return message;
  const code = /\[([a-z_]+)\]/.exec(message)?.[1];
  const reason = code && Object.hasOwn(reasons, code) ? reasons[code as Reason][pl ? 0 : 1] : reasons.invalid_decision[pl ? 0 : 1];
  const syntax = code === "invalid_json";
  return `${syntax ? (pl ? "Nie udało się odczytać decyzji prowadzącego." : "Could not read the lead's decision.") : (pl ? "Decyzja prowadzącego nie spełnia kontraktu." : "The lead's decision violates the contract.")} ${reason}`;
}

import type { InterfaceLanguage } from "../types";
import type { SessionSnapshot, SessionEventRecord, RvSession } from "./types";

export type SessionFocus = "location" | "activity" | "event";
export interface SessionFocusPlan {
  version: 1;
  first: SessionFocus;
  second?: SessionFocus;
}
export const SESSION_FOCUS_INSTRUCTION_VERSION = 1;

export function validateSessionFocus(value: unknown): SessionFocusPlan | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid session focus plan.");
  const plan = value as Record<string, unknown>;
  const valid = (focus: unknown) => typeof focus === "string" && ["location", "activity", "event"].includes(focus);
  if (plan.version !== 1 || !valid(plan.first) || (plan.second !== undefined && !valid(plan.second))
    || Object.keys(plan).some(key => !["version", "first", "second"].includes(key))) {
    throw new Error("Invalid session focus plan.");
  }
  return { version: 1, first: plan.first as SessionFocus, ...(plan.second !== undefined ? { second: plan.second as SessionFocus } : {}) };
}

export function sessionFocusLabel(focus: SessionFocus, language: InterfaceLanguage): string {
  return language === "pl" ? { location: "lokalizacja", activity: "aktywność", event: "wydarzenie" }[focus] : focus;
}

export function focusPasses(plan?: SessionFocusPlan): Array<1 | 2> {
  return plan?.second ? [1, 2] : [1];
}

export function focusMetadata(plan: SessionFocusPlan | undefined, passIndex: 1 | 2) {
  return plan ? { passIndex, sessionFocus: passIndex === 1 ? plan.first : plan.second, focusInstructionVersion: SESSION_FOCUS_INSTRUCTION_VERSION } : {};
}

export function focusOpening(prompt: string, plan: SessionFocusPlan | undefined, passIndex: 1 | 2, language: InterfaceLanguage, code: string): string {
  if (!plan) return prompt;
  const focus = passIndex === 1 ? plan.first : plan.second!;
  const label = sessionFocusLabel(focus, language);
  const heading = language === "pl" ? "ŚLEPY KOD CELU" : "BLIND TARGET CODE";
  // Modify only known header lines. Never replace a code inside user protocol prose.
  const lines = prompt.split("\n");
  const controlledHeaders = [`${heading}: ${code}`, `Hello. The target code is: **${code}**.`, `Witaj. Kod celu to: **${code}**.`];
  const at = lines.findIndex(line => controlledHeaders.includes(line.trim()));
  if (passIndex === 1) {
    if (at >= 0) {
      lines[at] = `${heading}: ${code} — ${label}.`;
      return lines.join("\n");
    }
    return `${heading}: ${code} — ${label}.\n${prompt}`;
  }
  if (at >= 0) lines.splice(at, 1);
  const inflected = { location: "lokalizacji", activity: "aktywności", event: "wydarzeniu" }[focus];
  const opening = language === "pl"
    ? `Cel pozostaje ten sam. W tej sesji skup się na ${inflected}.`
    : `The target remains the same. In this session, focus on ${label}.`;
  return `${opening}\n${lines.join("\n")}`;
}

export function focusHeading(plan: SessionFocusPlan, passIndex: 1 | 2, language: InterfaceLanguage): string {
  return `## ${language === "pl" ? "Sesja" : "Session"} ${passIndex} — ${sessionFocusLabel(passIndex === 1 ? plan.first : plan.second!, language)}`;
}

export function focusFeedbackIntroduction(plan: SessionFocusPlan | undefined, language: InterfaceLanguage): string {
  if (!plan) return "";
  const first = sessionFocusLabel(plan.first, language);
  const second = plan.second ? sessionFocusLabel(plan.second, language) : undefined;
  return language === "pl"
    ? `Ujawnienie dotyczy ${second ? "dwóch pełnych sesji" : "jednej pełnej sesji"} do tego samego celu. Sesja 1 — ${first}.${second ? ` Sesja 2 — ${second}. Omów każdą osobno i ich wspólny obraz.` : " Omów tę sesję zgodnie z jej kierunkiem."} Porównaj feedback z zapieczętowanymi danymi. Nie przepisuj ani nie uzupełniaj danych blind po ujawnieniu celu.`
    : `This reveal applies to ${second ? "two complete sessions" : "one complete session"} for the same target. Session 1 focused on ${first}.${second ? ` Session 2 focused on ${second}. Discuss each session separately and their combined picture.` : " Discuss this session according to its focus."} Compare the feedback with the sealed evidence. Do not rewrite or supplement blind evidence after the target is revealed.`;
}

export function assertFocusPassesComplete(snapshot: SessionSnapshot | null, events: SessionEventRecord[], session?: RvSession | null): void {
  const plan = validateSessionFocus(snapshot?.sessionFocus);
  if (!plan) return;
  if (snapshot?.sessionFocusInstructionVersion !== SESSION_FOCUS_INSTRUCTION_VERSION || snapshot.monitor || snapshot.protocol.id.startsWith("telepathic")) {
    throw new Error("Invalid focused session snapshot.");
  }
  for (const passIndex of focusPasses(plan)) {
    const completed = events.filter(event => event.eventType === "FOCUS_PASS_COMPLETED" && event.metadata?.passIndex === passIndex);
    if (completed.length !== 1 || !/^[a-f0-9]{64}$/.test(String(completed[0].metadata?.sha256))) {
      throw new Error("All planned focused sessions must complete before seal or Reveal.");
    }
  }
  if (session !== undefined && !session?.preRevealSealedAt) throw new Error("Focused sessions must be sealed before Reveal.");
}

/** Each message has its own fence, longer than any fence contained in the data. */
export function focusTranscriptContent(content: string, plan?: SessionFocusPlan): string {
  if (!plan) return content;
  const longest = Math.max(2, ...(content.match(/`+/g) ?? []).map(value => value.length));
  const fence = "`".repeat(longest + 1);
  return `${fence}text\n${content.trim()}\n${fence}`;
}

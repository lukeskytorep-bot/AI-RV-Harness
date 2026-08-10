export type RepetitionSeverity = "clear" | "warning" | "stop";

export interface RepetitionInspection {
  severity: RepetitionSeverity;
  rule?: string;
  fragment?: string;
}

const PROTOCOL_LABEL = /^(?:(?:touch|phase|faza|step|krok|prompt)\s*\d+|(?:echo dot|contact category|primitive descriptor|advanced descriptor|forming|element \d+|monitor questions?))\s*:?[\s*]*$/i;
const CONTROLLED_DESCRIPTOR = /^(?:structure|liquid|energy|land|movement|mountain|person|object|hard|soft|elastic|semi[- ]?hard|fluid|semi[- ]?soft|spongy|flexible|natural|artificial|man[- ]?made|energetic|moving|struktura|ciecz|energia|teren|ruch|góra|osoba|obiekt|twarde?|miękkie?|naturalne?|sztuczne?)$/i;

/**
 * Stateful guard used by every automatic controller. A borderline pattern only
 * emits a warning the first time; another borderline pattern in the immediately
 * following Viewer response is promoted to a stop. A clearly repeated long
 * passage remains an immediate hard stop.
 */
export class RepetitionGuard {
  private previousWarning = false;

  inspect(content: string): RepetitionInspection {
    const finding = analyzeRepetitiveOutput(content);
    if (finding.severity === "stop") {
      this.previousWarning = false;
      return finding;
    }
    if (finding.severity === "warning") {
      if (this.previousWarning) {
        this.previousWarning = false;
        return { ...finding, severity: "stop", rule: `consecutive-${finding.rule ?? "repetition"}` };
      }
      this.previousWarning = true;
      return finding;
    }
    this.previousWarning = false;
    return finding;
  }
}

export function analyzeRepetitiveOutput(content: string): RepetitionInspection {
  const prose = proseOutsideCodeFences(content);
  const normalized = prose.replace(/\s+/g, " ").trim();
  if (normalized.length < 160) return { severity: "clear" };

  const substantiveLines = prose
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((line): line is string => Boolean(line));
  const lineFinding = repeatedExact(substantiveLines, 3, 5, "long-line-repeat");
  if (lineFinding) return lineFinding;

  const paragraphs = prose
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.split(/\r?\n/).map(cleanLine).filter(Boolean).join(" ").replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph.length >= 100 && wordCount(paragraph) >= 16);
  const paragraphFinding = repeatedExact(paragraphs, 2, 3, "long-paragraph-repeat");
  if (paragraphFinding) return paragraphFinding;

  // N-gram analysis uses only substantive prose. Protocol headings, numbered
  // field labels and controlled one-word descriptors must never bridge into a
  // synthetic repeated passage.
  const substantiveProse = substantiveLines.join(" ");
  const words = substantiveProse.toLocaleLowerCase().match(/[\p{L}\p{N}'’-]+/gu) ?? [];
  if (words.length < 64) return { severity: "clear" };
  const windowSize = 16;
  const occurrences = new Map<string, number[]>();
  for (let index = 0; index <= words.length - windowSize; index += 1) {
    const window = words.slice(index, index + windowSize).join(" ");
    const positions = occurrences.get(window) ?? [];
    const last = positions.at(-1);
    if (last === undefined || index - last >= windowSize) positions.push(index);
    occurrences.set(window, positions);
  }
  let warning: RepetitionInspection | null = null;
  for (const [fragment, positions] of occurrences) {
    if (positions.length >= 4) return { severity: "stop", rule: "repeated-16-word-passage", fragment };
    if (!warning && positions.length >= 3) warning = { severity: "warning", rule: "repeated-16-word-passage", fragment };
  }
  return warning ?? { severity: "clear" };
}

/** Backward-compatible immediate-loop predicate used by older callers/tests. */
export function detectRepetitiveOutput(content: string): boolean {
  return analyzeRepetitiveOutput(content).severity === "stop";
}

export function formatRepetitionStopReason(finding: RepetitionInspection): string {
  const fragment = finding.fragment?.replace(/\s+/g, " ").trim().slice(0, 120);
  return `AUTO-STOP: repetitive output detected${finding.rule ? ` [${finding.rule}]` : ""}${fragment ? ` — ${fragment}` : ""}`;
}

function proseOutsideCodeFences(content: string): string {
  let fenced = false;
  const visible: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) visible.push(line);
  }
  return visible.join("\n");
}

function cleanLine(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /^\s*(?:[-_*═=]\s*){3,}$/.test(trimmed) || /^#{1,6}\s+/.test(trimmed)) return null;
  const withoutMarkup = trimmed
    .replace(/^[-+>]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!withoutMarkup || PROTOCOL_LABEL.test(withoutMarkup) || CONTROLLED_DESCRIPTOR.test(withoutMarkup)) return null;
  if (withoutMarkup.length < 40 || wordCount(withoutMarkup) < 7) return null;
  return withoutMarkup.toLocaleLowerCase();
}

function repeatedExact(values: string[], warningAt: number, stopAt: number, rule: string): RepetitionInspection | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let warning: RepetitionInspection | null = null;
  for (const [fragment, count] of counts) {
    if (count >= stopAt) return { severity: "stop", rule, fragment };
    if (!warning && count >= warningAt) warning = { severity: "warning", rule, fragment };
  }
  return warning;
}

function wordCount(value: string): number {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

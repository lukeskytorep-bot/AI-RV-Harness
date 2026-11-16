import type { InterfaceLanguage } from "../types";

export type RepetitionSeverity = "clear" | "warning" | "stop";

export interface RepetitionInspection {
  severity: RepetitionSeverity;
  rule?: string;
  kind?: "ascii_sketch";
  fragment?: string;
  cutAt?: number;
}

export interface SanitizedRepetitiveOutput {
  content: string;
  truncated: boolean;
  originalLength: number;
  retainedLength: number;
  finding?: RepetitionInspection;
}

const IDENTICAL_LINE_LIMIT = 60;
const IDENTICAL_CHARACTER_LIMIT = 600;
const MIN_PERIOD = 12;
const MAX_PERIOD = 1_000;
const TAIL_REPEAT_LIMIT = 20;

const ASCII_STROKE_LIMIT = 2_048;
const ASCII_ROW_LIMIT = 128;
const ASCII_ROW_MAX_WIDTH = 4_096;
const ASCII_STROKES = "-_=+*~|.:/\\#%";
const ASCII_DRAWING_ROW = /^[\t \-_=+*~|.:/\\<>\[\]{}()^#%]+$/;

function isAsciiDrawingRow(row: string): boolean {
  if (row.length < 4) return false;
  if (ASCII_DRAWING_ROW.test(row)) return true;
  if (!ASCII_DRAWING_ROW.test(row[0])) return false;

  // Count a single letter or digit between drawing glyphs as a marker.
  // Empty sections reject adjacent markers and labels at either end.
  const compact = row.replace(/[\t ]/g, "");
  const sections = compact.split(/[A-Za-z0-9]/);
  const markers = sections.length - 1;
  return compact.length - markers >= 4
    && markers * 10 <= compact.length * 3
    && sections.every(section => ASCII_DRAWING_ROW.test(section));
}

/** Shared linear scan. Offsets and the current row survive arbitrary SSE splits. */
export function createAsciiSketchScanner() {
  let offset = 0;
  let rowStart = 0;
  let row = "";
  let previousRow = "";
  let rowCount = 0;
  let repeatedRowStart = 0;
  let previousChar = "";
  let strokeLength = 0;
  let finding: RepetitionInspection | undefined;

  const finishRow = () => {
    const drawing = row.length <= ASCII_ROW_MAX_WIDTH ? row.trim() : "";
    if (!isAsciiDrawingRow(drawing)) {
      previousRow = "";
      rowCount = 0;
      return;
    }
    if (drawing === previousRow) rowCount++;
    else {
      previousRow = drawing;
      rowCount = 1;
      repeatedRowStart = rowStart;
    }
    if (rowCount >= ASCII_ROW_LIMIT) finding = {
      severity: "stop", kind: "ascii_sketch", rule: "ascii-identical-rows",
      fragment: drawing.slice(0, 120), cutAt: repeatedRowStart,
    };
  };

  return {
    push(chunk: string): RepetitionInspection | undefined {
      for (let i = 0; i < chunk.length && !finding; i++, offset++) {
        const char = chunk[i];
        if (char === "\n") {
          finishRow();
          rowStart = offset + 1;
          row = "";
        } else if (row.length <= ASCII_ROW_MAX_WIDTH) {
          row += char;
        }
        strokeLength = char === previousChar ? strokeLength + 1 : 1;
        previousChar = char;
        if (strokeLength === ASCII_STROKE_LIMIT && ASCII_STROKES.includes(char)) {
          finding = { severity: "stop", kind: "ascii_sketch", rule: "ascii-long-stroke", fragment: char.repeat(80), cutAt: offset - strokeLength + 1 };
        }
      }
      return finding;
    },
    finish(): RepetitionInspection | undefined {
      if (!finding && row) finishRow();
      return finding;
    },
  };
}

export function inspectAsciiSketch(content: string): RepetitionInspection | undefined {
  const scanner = createAsciiSketchScanner();
  return scanner.push(content) ?? scanner.finish();
}

/** Compatibility wrapper retained for integrations which construct a guard. */
export class RepetitionGuard {
  inspect(content: string): RepetitionInspection {
    return analyzeRepetitiveOutput(content);
  }
}

/**
 * Detects only unmistakable generation runaways. Repeated RV field names,
 * descriptors, touches and ordinary prose are valid protocol data and are not
 * scored. This is a last-resort repetition-runaway detector, not a size limit or semantic classifier.
 */
export function analyzeRepetitiveOutput(content: string): RepetitionInspection {
  const ascii = inspectAsciiSketch(content);
  if (ascii) return ascii;
  const scannable = maskFencedDrawingLines(content);
  return findCharacterRun(scannable)
    ?? findConsecutiveIdenticalLines(scannable)
    ?? findRepeatedTailBlock(scannable)
    ?? { severity: "clear" };
}

/** Backward-compatible predicate used by tests and older callers. */
export function detectRepetitiveOutput(content: string): boolean {
  return analyzeRepetitiveOutput(content).severity === "stop";
}

/**
 * Preserves valid evidence, removes only an unmistakable runaway suffix and appends a
 * durable marker. Callers must treat a truncated result as incomplete, never as an accepted protocol step.
 */
export function sanitizeRepetitiveOutput(
  content: string,
  language: InterfaceLanguage = "en",
  finding = analyzeRepetitiveOutput(content),
): SanitizedRepetitiveOutput {
  if (finding.severity !== "stop" || finding.cutAt === undefined) {
    return { content, truncated: false, originalLength: content.length, retainedLength: content.length };
  }

  const marker = finding.kind === "ascii_sketch"
    ? language === "pl" ? "[SZKIC SKRÓCONY — wykryto pętlę rysowania.]" : "[SKETCH TRUNCATED — a drawing loop was detected.]"
    : language === "pl"
    ? "[ODPOWIEDŹ SKRÓCONA — wykryto jednoznaczne zapętlenie generowania; prawidłowe dane sprzed tego miejsca zostały zachowane.]"
    : "[OUTPUT TRUNCATED — a clear generation loop was detected; valid material before this point was preserved.]";
  const retained = content.slice(0, Math.max(0, finding.cutAt)).trimEnd();
  let closingFence = "";
  if (finding.kind === "ascii_sketch") {
    let fence: RepetitionFenceState | null = null;
    for (const line of retained.split(/(?<=\n)/)) fence = maskRepetitionLine(line, fence).nextFence;
    if (fence) closingFence = "\n" + fence.marker.repeat(fence.length);
  }
  const sanitized = `${retained}${closingFence}${retained ? "\n\n" : ""}${marker}`;
  return {
    content: sanitized,
    truncated: true,
    originalLength: content.length,
    retainedLength: retained.length,
    finding,
  };
}

/** Legacy formatter kept for downstream source compatibility. */
export function formatRepetitionStopReason(finding: RepetitionInspection): string {
  const fragment = finding.fragment?.replace(/\s+/g, " ").trim().slice(0, 120);
  return `OUTPUT TRUNCATED: clear generation loop detected${finding.rule ? ` [${finding.rule}]` : ""}${fragment ? ` — ${fragment}` : ""}`;
}

export interface RepetitionFenceState { marker: "`" | "~"; length: number }

/**
 * Masks one logical line while carrying fence state across bounded/incremental
 * scans. Output length always matches input length so detector offsets still map
 * back to the raw response.
 */
export function maskRepetitionLine(
  line: string,
  fence: RepetitionFenceState | null,
): { masked: string; nextFence: RepetitionFenceState | null } {
  const markerMatch = line.match(/^\s*(`{3,}|~{3,})/);
  const marker = markerMatch?.[1];
  const isFenceBoundary = Boolean(marker && (!fence || (marker[0] === fence.marker && marker.length >= fence.length)));
  const inside = Boolean(fence);
  if (isFenceBoundary && marker) {
    return {
      masked: line.replace(/[^\n\r]/g, " "),
      nextFence: fence ? null : { marker: marker[0] as "`" | "~", length: marker.length },
    };
  }
  // Structural ASCII rows use the higher sketch threshold even outside fences.
  const drawing = line.trim();
  if (isAsciiDrawingRow(drawing)) {
    return { masked: line.replace(/[^\n\r]/g, " "), nextFence: fence };
  }
  if (!inside) return { masked: line, nextFence: fence };

  // Fenced blocks are often used for ASCII sketches in RV. Mask only lines that
  // are predominantly structural drawing glyphs. Natural-language/code text in
  // a fence remains scannable, so a real repeated sentence loop is still caught.
  const body = line.replace(/[\r\n]+$/g, "");
  const compact = body.replace(/\s/g, "");
  if (!compact) return { masked: line, nextFence: fence };
  const alnum = (compact.match(/[\p{L}\p{N}]/gu) ?? []).length;
  const structural = (compact.match(/[-_=+*~|.:/\\<>\[\]{}()^vVxX]/g) ?? []).length;
  const drawingLike = structural >= 4 && alnum / compact.length <= 0.3;
  return { masked: drawingLike ? line.replace(/[^\n\r]/g, " ") : line, nextFence: fence };
}

function maskFencedDrawingLines(content: string): string {
  const lines = content.split(/(?<=\n)/);
  let fence: RepetitionFenceState | null = null;
  return lines.map((line) => {
    const result = maskRepetitionLine(line, fence);
    fence = result.nextFence;
    return result.masked;
  }).join("");
}

function findCharacterRun(content: string): RepetitionInspection | null {
  let runStart = 0;
  let runLength = 0;
  let previous = "";
  for (let index = 0; index < content.length; index += 1) {
    const current = content[index];
    if (!/\s/.test(current) && !/[-_=+*~|.:]/.test(current) && current === previous) {
      runLength += 1;
    } else {
      previous = current;
      runStart = index;
      runLength = /\s/.test(current) || /[-_=+*~|.:]/.test(current) ? 0 : 1;
    }
    if (runLength >= IDENTICAL_CHARACTER_LIMIT) {
      return {
        severity: "stop",
        rule: "identical-character-run",
        fragment: current.repeat(Math.min(80, runLength)),
        cutAt: Math.min(content.length, runStart + 16),
      };
    }
  }
  return null;
}

function findConsecutiveIdenticalLines(content: string): RepetitionInspection | null {
  const lines = content.split(/(?<=\n)/);
  let offset = 0;
  let previous = "";
  let runCount = 0;
  let runStart = 0;
  let thirdLineEnd = 0;

  for (const rawLine of lines) {
    const normalized = rawLine.trim().replace(/\s+/g, " ").toLocaleLowerCase();
    const structuralOnly = normalized !== "" && /^[\-_=+*~|.:\s]+$/.test(normalized);
    if (normalized && !structuralOnly && normalized === previous) {
      runCount += 1;
      if (runCount === 3) thirdLineEnd = offset + rawLine.length;
    } else {
      previous = structuralOnly ? "" : normalized;
      runCount = normalized && !structuralOnly ? 1 : 0;
      runStart = offset;
      thirdLineEnd = offset + rawLine.length;
    }
    if (normalized && !structuralOnly && runCount >= IDENTICAL_LINE_LIMIT) {
      return {
        severity: "stop",
        rule: "consecutive-identical-lines",
        fragment: normalized.slice(0, 120),
        cutAt: Math.max(runStart, thirdLineEnd),
      };
    }
    offset += rawLine.length;
  }
  return null;
}

function findRepeatedTailBlock(content: string): RepetitionInspection | null {
  if (content.length < MIN_PERIOD * TAIL_REPEAT_LIMIT) return null;
  const searchStart = Math.max(0, content.length - 24_000);
  const tail = content.slice(searchStart);
  const maxPeriod = Math.min(MAX_PERIOD, Math.floor(tail.length / TAIL_REPEAT_LIMIT));

  for (let period = MIN_PERIOD; period <= maxPeriod; period += 1) {
    const block = tail.slice(-period);
    if (!block.trim() || new Set(block.replace(/\s/g, "")).size < 2 || !/[\p{L}\p{N}]/u.test(block)) continue;
    let repeats = 1;
    while (repeats < 200) {
      const end = tail.length - repeats * period;
      const start = end - period;
      if (start < 0 || tail.slice(start, end) !== block) break;
      repeats += 1;
    }
    if (repeats >= TAIL_REPEAT_LIMIT) {
      const repeatedStart = content.length - repeats * period;
      return {
        severity: "stop",
        rule: "repeated-tail-block",
        fragment: block.trim().replace(/\s+/g, " ").slice(0, 120),
        cutAt: Math.min(content.length, repeatedStart + period * 3),
      };
    }
  }
  return null;
}

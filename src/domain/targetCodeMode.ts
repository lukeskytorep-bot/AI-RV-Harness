/** Visibility of the assigned target identifier, not target selection or Reveal. */
export type TargetCodeMode = "with_code" | "without_code";

export function isTargetCodeMode(value: unknown): value is TargetCodeMode {
  return value === "with_code" || value === "without_code";
}

/** Only an absent setting is legacy/default. Invalid persisted values fail closed. */
export function resolveTargetCodeMode(value: unknown): TargetCodeMode {
  if (value === undefined) return "with_code";
  if (!isTargetCodeMode(value)) throw new Error("Invalid target-code mode.");
  return value;
}

/** Reject rather than redact: redaction could change protocol or accepted history. */
export function assertTargetCodeAbsent(mode: TargetCodeMode, sessionCode: string, payload: unknown): void {
  if (resolveTargetCodeMode(mode) === "with_code") return;
  if (typeof sessionCode !== "string" || !sessionCode.trim()) throw new Error("Without-code requires a non-empty assigned session code.");
  const serialized = JSON.stringify(payload);
  if (serialized === undefined) throw new Error("Without-code requires a serializable Viewer payload.");
  // Search both literal text and JSON-escaped text (e.g. a quote in a code).
  if (serialized.includes(sessionCode) || serialized.includes(JSON.stringify(sessionCode).slice(1, -1))) {
    throw new Error("Target-code policy refused an assigned session code in the Without-code Viewer payload.");
  }
}

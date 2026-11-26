import { sha256Text } from "../application/sha256";
import type { SessionSnapshot } from "./types";

/** Independent of the optional policy fields: losing a policy cannot become legacy.
 * This detects accidental corruption, not an attacker rewriting the entire record.
 */
export interface SessionTargetCodeContract {
  version: 1;
  policyField: "profileTargetCode" | "researchTargetCode" | "rcpProfileTargetCode" | "telepathicProfileTargetCode" | "legacy";
  sha256: string;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => canonical(item)).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
const fields = ["profileTargetCode", "researchTargetCode", "rcpProfileTargetCode", "telepathicProfileTargetCode"] as const;
export type SessionTargetCodeContractSource = Pick<SessionSnapshot,
  "sessionId" | "sessionCode" | "sessionLanguage" | "protocol" | "profileTargetCode" | "researchTargetCode" | "rcpProfileTargetCode" | "telepathicProfileTargetCode">
  & Partial<Pick<SessionSnapshot, "schemaVersion" | "targetCodeContract">>;
function projection(snapshot: SessionTargetCodeContractSource) {
  const present = fields.filter(field => snapshot[field] !== undefined);
  if (present.length > 1) throw new Error("Conflicting Session target-code policies.");
  const policyField: SessionTargetCodeContract["policyField"] = present.length ? present[0] : "legacy";
  const policy = policyField === "legacy" ? null : snapshot[policyField];
  if (policyField !== "legacy" && (!policy || typeof policy !== "object")) throw new Error("Invalid Session target-code policy.");
  return { policyField, sessionId: snapshot.sessionId, sessionCode: snapshot.sessionCode,
    sessionLanguage: snapshot.sessionLanguage, protocol: snapshot.protocol, policy };
}

/** Called only for genuinely new snapshots. Never upgrade historical snapshots on Resume. */
export async function captureSessionTargetCodeContract(snapshot: SessionSnapshot): Promise<void> {
  const value = projection(snapshot);
  snapshot.schemaVersion = 5;
  snapshot.targetCodeContract = { version: 1, policyField: value.policyField, sha256: await sha256Text(canonical(value)) };
}

/** Existing v1–4 records keep their historical meaning, including frozen policies. */
export async function validateSessionTargetCodeContract(snapshot: SessionTargetCodeContractSource, sessionId?: string): Promise<void> {
  if ([1, 2, 3, 4].includes(snapshot.schemaVersion as number) && snapshot.targetCodeContract === undefined) return;
  const saved = snapshot.targetCodeContract;
  const value = projection(snapshot);
  if (snapshot.schemaVersion !== 5 || (sessionId !== undefined && snapshot.sessionId !== sessionId) || !saved || saved.version !== 1 || saved.policyField !== value.policyField
    || saved.sha256 !== await sha256Text(canonical(value))) {
    throw new Error("Session Snapshot target-code contract mismatch or missing. Dispatch refused.");
  }
}

/** Partial UI helper inputs are not durable records. Repositories always use the strict validator. */
export async function validateSessionTargetCodeFragment(snapshot: SessionTargetCodeContractSource): Promise<void> {
  if (snapshot.schemaVersion === undefined && snapshot.targetCodeContract === undefined) return;
  await validateSessionTargetCodeContract(snapshot);
}

export function assertSessionTargetCodeBinding(snapshot: SessionTargetCodeContractSource, session: { id: string; sessionCode: string }): void {
  if (snapshot.schemaVersion === 5 && (snapshot.sessionId !== session.id || snapshot.sessionCode !== session.sessionCode)) {
    throw new Error("Session Snapshot target-code contract mismatch with the saved session.");
  }
}

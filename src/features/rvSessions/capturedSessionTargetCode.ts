import { isTargetCodeMode, type TargetCodeMode } from "../../domain/targetCodeMode";
import { assertTargetCodePolicy } from "../../resources/rvLiteTargetCode";
import { assertRcpTargetCodePolicy } from "../../sessions/rcpTargetCode";
import { restoreTelepathicTargetCode } from "../../sessions/telepathicTargetCode";
import type { RvSession, SessionSnapshot } from "../../sessions/types";

/** A restart is a new session, but inherits the original RV Lite, RCP or Telepathic experimental condition. */
export async function capturedSessionTargetCode(
  snapshot: Pick<SessionSnapshot, "protocol" | "profileTargetCode" | "rcpProfileTargetCode" | "telepathicProfileTargetCode" | "researchTargetCode" | "sessionId" | "sessionCode" | "sessionLanguage">,
  resume: boolean,
  currentProfileMode: TargetCodeMode | undefined,
  session?: Pick<RvSession, "id" | "sessionCode">,
): Promise<{ blocked: boolean; restartOptions: { targetCodeMode?: TargetCodeMode } }> {
  const frozen = snapshot.profileTargetCode;
  const rcp = snapshot.rcpProfileTargetCode;
  const isTelepathic = snapshot.protocol.id === "telepathic-protocol" || snapshot.telepathicProfileTargetCode !== undefined;
  if (isTelepathic && !session) throw new Error("The saved Telepathic session is required for target-code validation.");
  const telepathic = isTelepathic && session ? await restoreTelepathicTargetCode(snapshot, session) : undefined;
  if (rcp && (frozen || snapshot.protocol.id !== "full-rcp")) throw new Error("Conflicting frozen RCP target-code policy.");
  if (frozen && (snapshot.protocol.id === "full-rcp" || snapshot.protocol.id === "telepathic-protocol")) throw new Error("Conflicting frozen RV Lite target-code policy.");
  if (rcp) assertRcpTargetCodePolicy(rcp.policy);
  const mode = telepathic?.policy.mode ?? rcp?.policy.mode ?? frozen?.policy.mode;
  if (frozen && !isTargetCodeMode(mode)) throw new Error("Invalid frozen target-code mode.");
  if (frozen && snapshot.protocol.id === "rv-lite" && !resume) {
    assertTargetCodePolicy(frozen.policy);
  }
  const blocked = snapshot.protocol.id !== "rv-lite" && snapshot.protocol.id !== "full-rcp" && snapshot.protocol.id !== "telepathic-protocol" &&
    (mode === "without_code" || (!resume && currentProfileMode === "without_code"));
  // Resume consumes the original snapshot in the controller; legacy restarts
  // deliberately omit the field to retain the original renderer and behavior.
  return { blocked, restartOptions: !resume && mode !== undefined ? { targetCodeMode: mode } : {} };
}

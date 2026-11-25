import { isTargetCodeMode, type TargetCodeMode } from "../../domain/targetCodeMode";
import { assertTargetCodePolicy } from "../../resources/rvLiteTargetCode";
import { assertRcpTargetCodePolicy } from "../../sessions/rcpTargetCode";
import type { SessionSnapshot } from "../../sessions/types";

/** A restart is a new session, but inherits the original RV Lite or RCP experimental condition. */
export function capturedSessionTargetCode(
  snapshot: Pick<SessionSnapshot, "protocol" | "profileTargetCode" | "rcpProfileTargetCode">,
  resume: boolean,
  currentProfileMode: TargetCodeMode | undefined,
): { blocked: boolean; restartOptions: { targetCodeMode?: TargetCodeMode } } {
  const frozen = snapshot.profileTargetCode;
  const rcp = snapshot.rcpProfileTargetCode;
  if (rcp && (frozen || snapshot.protocol.id !== "full-rcp")) throw new Error("Conflicting frozen RCP target-code policy.");
  if (frozen && snapshot.protocol.id === "full-rcp") throw new Error("Conflicting frozen RV Lite target-code policy.");
  if (rcp) assertRcpTargetCodePolicy(rcp.policy);
  const mode = rcp?.policy.mode ?? frozen?.policy.mode;
  if (frozen && !isTargetCodeMode(mode)) throw new Error("Invalid frozen target-code mode.");
  if (frozen && snapshot.protocol.id === "rv-lite" && !resume) {
    assertTargetCodePolicy(frozen.policy);
  }
  const blocked = snapshot.protocol.id !== "rv-lite" && snapshot.protocol.id !== "full-rcp" &&
    (mode === "without_code" || (!resume && currentProfileMode === "without_code"));
  // Resume consumes the original snapshot in the controller; legacy restarts
  // deliberately omit the field to retain the original renderer and behavior.
  return { blocked, restartOptions: !resume && mode !== undefined ? { targetCodeMode: mode } : {} };
}

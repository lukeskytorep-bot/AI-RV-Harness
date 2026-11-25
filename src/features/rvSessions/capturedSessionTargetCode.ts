import { isTargetCodeMode, type TargetCodeMode } from "../../domain/targetCodeMode";
import { assertTargetCodePolicy } from "../../resources/rvLiteTargetCode";
import type { SessionSnapshot } from "../../sessions/types";

/** A restart is a new session, but inherits the original RV Lite experimental condition. */
export function capturedSessionTargetCode(
  snapshot: Pick<SessionSnapshot, "protocol" | "profileTargetCode">,
  resume: boolean,
  currentProfileMode: TargetCodeMode | undefined,
): { blocked: boolean; restartOptions: { targetCodeMode?: TargetCodeMode } } {
  const frozen = snapshot.profileTargetCode;
  const mode = frozen?.policy.mode;
  if (frozen && !isTargetCodeMode(mode)) throw new Error("Invalid frozen target-code mode.");
  if (frozen && snapshot.protocol.id === "rv-lite" && !resume) {
    assertTargetCodePolicy(frozen.policy);
  }
  const blocked = snapshot.protocol.id !== "rv-lite" &&
    (mode === "without_code" || (!resume && currentProfileMode === "without_code"));
  // Resume consumes the original snapshot in the controller; legacy restarts
  // deliberately omit the field to retain the original renderer and behavior.
  return { blocked, restartOptions: !resume && mode !== undefined ? { targetCodeMode: mode } : {} };
}

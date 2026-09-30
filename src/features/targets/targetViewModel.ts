import { userTargetKind } from "../../targets/service";
import type { TargetRecord, TargetUsageRecord } from "../../targets/types";

export interface TargetGroups {
  training: TargetRecord[];
  general: TargetRecord[];
  telepathic: TargetRecord[];
}

export function groupTargets(targets: TargetRecord[]): TargetGroups {
  return {
    training: targets.filter((target) => target.collection === "training"),
    general: targets.filter((target) => target.collection === "user" && userTargetKind(target) === "general"),
    telepathic: targets.filter((target) => target.collection === "user" && userTargetKind(target) === "telepathic"),
  };
}

export function collectLockedTargetIds(
  usage: TargetUsageRecord[],
  researchLockedTargetIds: Iterable<string>,
): Set<string> {
  return new Set([
    ...usage.map((item) => item.targetId),
    ...researchLockedTargetIds,
  ]);
}

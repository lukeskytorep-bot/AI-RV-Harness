import type { TelepathicSeriesState } from "./types";
export function telepathicRuntimeMetrics(state: Pick<TelepathicSeriesState,"providerCalls" | "activeElapsedMs">) {
  const records = state.providerCalls.filter(c => c.status !== "prepared");
  let knownTokens = 0, costUsd = 0, estimated = false, tokensMissing = 0, costMissing = 0, tokenReports = 0, costReports = 0, calls = 0;
  for (const call of records) {
    const attempts = call.physicalAttempts ?? 1;
    calls += attempts;
    const usage = call.usage;
    const hasTokens = usage?.totalTokens !== undefined || usage?.inputTokens !== undefined || usage?.outputTokens !== undefined;
    if (hasTokens) {
      tokenReports++;
      // Reasoning is already included in completion/total, never added again.
      knownTokens += usage?.totalTokens ?? ((usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0));
    }
    const completeTokens = usage?.totalTokens !== undefined || (usage?.inputTokens !== undefined && usage?.outputTokens !== undefined);
    tokensMissing += Math.max(0, attempts - (completeTokens ? 1 : 0));
    if (usage?.costUsd !== undefined) { costReports++; costUsd += usage.costUsd; estimated ||= call.costSource === "estimated"; }
    costMissing += Math.max(0, attempts - (usage?.costUsd !== undefined ? 1 : 0));
  }
  return { calls, tokens: tokenReports || !calls ? knownTokens : null, knownTokens, tokensMissing, costUsd, costReports, costMissing,
    knownCostSource: estimated ? "estimated" : "provider", costSource: costMissing ? "incomplete" : estimated ? "estimated" : "provider", activeElapsedMs: state.activeElapsedMs ?? 0 };
}

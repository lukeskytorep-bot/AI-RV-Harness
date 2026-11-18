import { getRvLite } from "../resources/protocolRegistry";
import { targetCodeSteps } from "../resources/rvLiteTargetCode";
import { assertTargetCodePolicy } from "../resources/rvLiteTargetCode";
import type { ResearchConfig } from "./types";

const canonical = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
export function assertTargetCodeDesign(config: ResearchConfig): void {
  if (config.templateType !== "target_code") {
    if (config.conditions.some(c => c.targetCode !== undefined)) throw new Error("Target-code rendering is restricted to the target_code Research template.");
    return;
  }
  if (config.protocol.id !== "rv-lite" || config.protocol.variant !== "extended" || config.protocol.version !== "1.1.0" || !config.protocol.contentSha256) throw new Error("Target-code Research requires frozen RV Lite Extended 1.1.0.");
  if ((config as unknown as Record<string, unknown>).sessionFocus || config.conditions.some(c => (c as unknown as Record<string, unknown>).sessionFocus)) throw new Error("Target-code Research does not support Session Focus or additional passes.");
  if (config.conditions.length !== 2) throw new Error("Target-code Research requires exactly two matched conditions.");
  for (const mode of ["with_code", "without_code"] as const) {
    const c = config.conditions.find(item => item.key === mode);
    if (!c?.targetCode || c.targetCode.mode !== mode || c.conditionInstruction || c.practiceOrder || c.customValue) throw new Error("Target-code conditions must use structural with_code/without_code modes without extra instructions.");
    assertTargetCodePolicy(c.targetCode);
    const resource = getRvLite(config.sessionLanguage, "extended");
    if (resource.contentSha256 !== config.protocol.contentSha256) throw new Error("Target-code base protocol hash mismatch.");
    targetCodeSteps(resource.steps, config.sessionLanguage, c.targetCode);
  }
  const normalized = config.conditions.map(({ key: _key, label: _label, targetCode: _code, ...rest }) => canonical(rest));
  if (normalized[0] !== normalized[1]) throw new Error("Target-code conditions must have identical routes, prompts, memory, sampling and output policies.");
}

export type AutomaticRunType = "automatic" | "monitor";
export type AutomaticProtocolKind = "rcp" | "lite" | "custom" | "telepathic";

export function isRunModeCompatible(runType: AutomaticRunType, protocol: AutomaticProtocolKind): boolean {
  return runType !== "monitor" || protocol === "rcp" || protocol === "telepathic";
}

export function canSelectMonitor(protocol: AutomaticProtocolKind): boolean {
  return isRunModeCompatible("monitor", protocol);
}

export function canSelectProtocol(runType: AutomaticRunType, protocol: AutomaticProtocolKind): boolean {
  return isRunModeCompatible(runType, protocol);
}

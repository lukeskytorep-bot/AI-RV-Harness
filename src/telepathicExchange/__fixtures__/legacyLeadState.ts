// Test-only reconstruction of an already persisted v1 series. Never used by UI creation.
import { createTelepathicSeriesState } from "../engine";
import { leadInstructions, LEGACY_LEAD_INSTRUCTION_VERSION } from "../leadGuidance";
import type { TelepathicSeriesConfig } from "../types";

export function legacyLeadState(config: TelepathicSeriesConfig, timestamp?: string) {
  const state = createTelepathicSeriesState(config, timestamp);
  if (config.protocolVersion === "fixed_lead_v1") {
    state.config.leadInstructionVersion = LEGACY_LEAD_INSTRUCTION_VERSION;
    state.config.leadInstruction = leadInstructions(config.language, LEGACY_LEAD_INSTRUCTION_VERSION);
  }
  return state;
}

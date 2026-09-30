import type { OperationTimeoutClass } from "./operationResourceProfiles";

export interface ProviderTimeoutPolicy {
  timeoutClass: OperationTimeoutClass;
  firstEventTimeoutMs: number;
  idleTimeoutMs: number;
  absoluteEmergencyTimeoutMs: number;
  nonStreamingTimeoutMs: number;
}

export const DEFAULT_PROVIDER_TIMEOUT_MS = 120_000;
export const MIN_PROVIDER_TIMEOUT_MS = 1_000;
export const MAX_PROVIDER_TIMEOUT_MS = 600_000;

const MIN_EMERGENCY_BY_CLASS: Record<OperationTimeoutClass, number> = {
  interactive: 15 * 60_000,
  analytical: 30 * 60_000,
  long_reasoning: 60 * 60_000,
};
const MAX_EMERGENCY_TIMEOUT_MS = 2 * 60 * 60_000;

function clampBaseTimeout(timeoutMs?: number): number {
  const raw = Number.isFinite(timeoutMs) ? Math.floor(timeoutMs as number) : DEFAULT_PROVIDER_TIMEOUT_MS;
  return Math.max(MIN_PROVIDER_TIMEOUT_MS, Math.min(MAX_PROVIDER_TIMEOUT_MS, raw));
}

function scaled(baseMs: number, numerator: number, denominator = 1): number {
  return Math.min(MAX_PROVIDER_TIMEOUT_MS, Math.ceil((baseMs * numerator) / denominator));
}

/**
 * S1 transport timeout policy. The existing Request timeout setting remains
 * the user's base dial; the ORP1 timeout class changes how that base is used.
 * Streaming requests use first-event + idle timeouts and a much larger bounded
 * emergency ceiling instead of treating the base timeout as a whole-request cap.
 */
export function resolveProviderTimeoutPolicy(timeoutClass: OperationTimeoutClass, configuredTimeoutMs?: number): ProviderTimeoutPolicy {
  const base = clampBaseTimeout(configuredTimeoutMs);
  let firstEventTimeoutMs = base;
  let idleTimeoutMs = base;
  let nonStreamingTimeoutMs = base;
  let emergencyMultiplier = 8;

  if (timeoutClass === "analytical") {
    firstEventTimeoutMs = scaled(base, 3, 2);
    idleTimeoutMs = scaled(base, 5, 4);
    nonStreamingTimeoutMs = firstEventTimeoutMs;
    emergencyMultiplier = 10;
  } else if (timeoutClass === "long_reasoning") {
    firstEventTimeoutMs = scaled(base, 5, 2);
    idleTimeoutMs = scaled(base, 3, 2);
    nonStreamingTimeoutMs = firstEventTimeoutMs;
    emergencyMultiplier = 12;
  }

  return {
    timeoutClass,
    firstEventTimeoutMs,
    idleTimeoutMs,
    absoluteEmergencyTimeoutMs: Math.min(
      MAX_EMERGENCY_TIMEOUT_MS,
      Math.max(MIN_EMERGENCY_BY_CLASS[timeoutClass], base * emergencyMultiplier),
    ),
    nonStreamingTimeoutMs,
  };
}

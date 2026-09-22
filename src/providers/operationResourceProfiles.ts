export type OperationKind =
  | "conversation"
  | "manual_rv_viewer"
  | "rv_session_viewer"
  | "training_blind_viewer"
  | "research_viewer"
  | "live_monitor"
  | "judge"
  | "post_reveal_viewer"
  | "post_reveal_monitor"
  | "field_guide_update"
  | "viewer_notes_reflection"
  | "generic_provider_call";

export type OperationOutputPolicy =
  | "configured_or_frozen"
  | "live_monitor"
  | "reasoning_heavy_analytical"
  | "capacity_bound_learning_object";

export type OperationReasoningPolicy =
  | "preserve_configured"
  | "preserve_monitor_behavior"
  | "substantial_headroom"
  | "bounded_learning_object";

export type OperationTimeoutClass = "interactive" | "analytical" | "long_reasoning";
export type StreamPresentation = "live" | "structured-final" | "hidden";
export type OperationRetryClass = "configured_transport" | "monitor_output_recovery" | "analytical_output_recovery";
export type CapacityRoutingPolicy = "default_auto" | "prefer_verified_fit";

export interface OperationResourceProfile {
  operationKind: OperationKind;
  outputPolicy: OperationOutputPolicy;
  reasoningPolicy: OperationReasoningPolicy;
  timeoutClass: OperationTimeoutClass;
  // ORP1 default only. S2 must resolve the final presentation with workflow context before consuming it.
  streamPresentation: StreamPresentation;
  retryClass: OperationRetryClass;
  capacityRoutingPolicy: CapacityRoutingPolicy;
}

const PROFILE_BY_KIND: Record<OperationKind, OperationResourceProfile> = {
  conversation: {
    operationKind: "conversation",
    outputPolicy: "configured_or_frozen",
    reasoningPolicy: "preserve_configured",
    timeoutClass: "interactive",
    streamPresentation: "live",
    retryClass: "configured_transport",
    capacityRoutingPolicy: "default_auto",
  },
  manual_rv_viewer: {
    operationKind: "manual_rv_viewer",
    outputPolicy: "configured_or_frozen",
    reasoningPolicy: "preserve_configured",
    timeoutClass: "interactive",
    streamPresentation: "live",
    retryClass: "configured_transport",
    capacityRoutingPolicy: "default_auto",
  },
  rv_session_viewer: {
    operationKind: "rv_session_viewer",
    outputPolicy: "configured_or_frozen",
    reasoningPolicy: "preserve_configured",
    timeoutClass: "interactive",
    streamPresentation: "live",
    retryClass: "configured_transport",
    capacityRoutingPolicy: "default_auto",
  },
  training_blind_viewer: {
    operationKind: "training_blind_viewer",
    outputPolicy: "configured_or_frozen",
    reasoningPolicy: "preserve_configured",
    timeoutClass: "interactive",
    streamPresentation: "hidden",
    retryClass: "configured_transport",
    capacityRoutingPolicy: "default_auto",
  },
  research_viewer: {
    operationKind: "research_viewer",
    outputPolicy: "configured_or_frozen",
    reasoningPolicy: "preserve_configured",
    timeoutClass: "interactive",
    streamPresentation: "hidden",
    retryClass: "configured_transport",
    capacityRoutingPolicy: "default_auto",
  },
  live_monitor: {
    operationKind: "live_monitor",
    outputPolicy: "live_monitor",
    reasoningPolicy: "preserve_monitor_behavior",
    timeoutClass: "interactive",
    streamPresentation: "live",
    retryClass: "monitor_output_recovery",
    capacityRoutingPolicy: "default_auto",
  },
  judge: {
    operationKind: "judge",
    outputPolicy: "reasoning_heavy_analytical",
    reasoningPolicy: "substantial_headroom",
    timeoutClass: "long_reasoning",
    streamPresentation: "structured-final",
    retryClass: "analytical_output_recovery",
    capacityRoutingPolicy: "prefer_verified_fit",
  },
  post_reveal_viewer: {
    operationKind: "post_reveal_viewer",
    outputPolicy: "reasoning_heavy_analytical",
    reasoningPolicy: "substantial_headroom",
    timeoutClass: "analytical",
    streamPresentation: "structured-final",
    retryClass: "analytical_output_recovery",
    capacityRoutingPolicy: "prefer_verified_fit",
  },
  post_reveal_monitor: {
    operationKind: "post_reveal_monitor",
    outputPolicy: "reasoning_heavy_analytical",
    reasoningPolicy: "substantial_headroom",
    timeoutClass: "analytical",
    streamPresentation: "structured-final",
    retryClass: "analytical_output_recovery",
    capacityRoutingPolicy: "prefer_verified_fit",
  },
  field_guide_update: {
    operationKind: "field_guide_update",
    outputPolicy: "capacity_bound_learning_object",
    reasoningPolicy: "bounded_learning_object",
    timeoutClass: "long_reasoning",
    streamPresentation: "hidden",
    retryClass: "analytical_output_recovery",
    capacityRoutingPolicy: "prefer_verified_fit",
  },
  viewer_notes_reflection: {
    operationKind: "viewer_notes_reflection",
    outputPolicy: "capacity_bound_learning_object",
    reasoningPolicy: "bounded_learning_object",
    timeoutClass: "long_reasoning",
    streamPresentation: "hidden",
    retryClass: "analytical_output_recovery",
    capacityRoutingPolicy: "prefer_verified_fit",
  },
  generic_provider_call: {
    operationKind: "generic_provider_call",
    outputPolicy: "configured_or_frozen",
    reasoningPolicy: "preserve_configured",
    timeoutClass: "interactive",
    streamPresentation: "hidden",
    retryClass: "configured_transport",
    capacityRoutingPolicy: "default_auto",
  },
};

export const LEARNING_OBJECT_STRUCTURED_OUTPUT_OVERHEAD_TOKENS = 256;
export const LEARNING_OBJECT_CHANGE_SUMMARY_OVERHEAD_TOKENS = 256;
export const LEARNING_OBJECT_SAFETY_ALLOWANCE_TOKENS = 512;
export const LEARNING_OBJECT_RECOVERY_EXTRA_ALLOWANCE_TOKENS = 1024;

export function getOperationResourceProfile(operationKind: OperationKind): OperationResourceProfile {
  return PROFILE_BY_KIND[operationKind];
}

export function inferOperationKind(operationId?: string): OperationKind {
  const id = operationId?.trim().toLowerCase() ?? "";
  if (id === "chat.conversation") return "conversation";
  if (id === "chat.manual-rv") return "manual_rv_viewer";
  if (id.startsWith("monitor.")) return "live_monitor";
  if (id.startsWith("judge.")) return "judge";
  if (id.startsWith("post-reveal.viewer")) return "post_reveal_viewer";
  if (id.startsWith("post-reveal.monitor")) return "post_reveal_monitor";
  if (id.startsWith("field-guide.")) return "field_guide_update";
  if (id.startsWith("viewer-notes.")) return "viewer_notes_reflection";
  if (id.startsWith("session.")) return "rv_session_viewer";
  return "generic_provider_call";
}

export function resolveOperationResourceProfile(input: {
  operationId?: string;
  operationKind?: OperationKind;
}): OperationResourceProfile {
  return getOperationResourceProfile(input.operationKind ?? inferOperationKind(input.operationId));
}

export function learningObjectOutputAllowance(capacityTokens: number, attempt: 0 | 1): number {
  const capacity = Math.max(1, Math.floor(capacityTokens));
  return capacity
    + LEARNING_OBJECT_STRUCTURED_OUTPUT_OVERHEAD_TOKENS
    + LEARNING_OBJECT_CHANGE_SUMMARY_OVERHEAD_TOKENS
    + LEARNING_OBJECT_SAFETY_ALLOWANCE_TOKENS
    + (attempt === 1 ? LEARNING_OBJECT_RECOVERY_EXTRA_ALLOWANCE_TOKENS : 0);
}

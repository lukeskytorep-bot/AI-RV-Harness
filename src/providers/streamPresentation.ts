import { getOperationResourceProfile, type OperationKind, type StreamPresentation } from "./operationResourceProfiles";

export type StreamWorkflowContext =
  | "conversation"
  | "manual_rv"
  | "rv_session"
  | "training"
  | "research"
  | "background";

export interface StreamPresentationDecision {
  workflowContext: StreamWorkflowContext;
  operationKind: OperationKind;
  presentation: StreamPresentation;
}

export function inferStreamWorkflowContext(operationKind: OperationKind): StreamWorkflowContext {
  switch (operationKind) {
    case "conversation": return "conversation";
    case "manual_rv_viewer": return "manual_rv";
    case "rv_session_viewer":
    case "live_monitor": return "rv_session";
    case "training_blind_viewer": return "training";
    case "research_viewer": return "research";
    default: return "background";
  }
}

export function resolveStreamPresentation(input: {
  operationKind: OperationKind;
  workflowContext?: StreamWorkflowContext;
}): StreamPresentationDecision {
  const workflowContext = input.workflowContext ?? inferStreamWorkflowContext(input.operationKind);
  let presentation: StreamPresentation = "hidden";

  if (workflowContext === "conversation" && input.operationKind === "conversation") {
    presentation = "live";
  } else if (workflowContext === "manual_rv" && input.operationKind === "manual_rv_viewer") {
    presentation = "live";
  } else if (workflowContext === "rv_session") {
    if (input.operationKind === "rv_session_viewer" || input.operationKind === "live_monitor") {
      presentation = "live";
    } else if (["judge", "post_reveal_viewer", "post_reveal_monitor"].includes(input.operationKind)) {
      presentation = "structured-final";
    } else {
      presentation = getOperationResourceProfile(input.operationKind).streamPresentation;
    }
  } else if (workflowContext === "training" || workflowContext === "research") {
    presentation = "hidden";
  } else {
    // Safe default for callers without an explicit workflow surface: transport may stream, presentation stays hidden.
    presentation = "hidden";
  }

  return { workflowContext, operationKind: input.operationKind, presentation };
}

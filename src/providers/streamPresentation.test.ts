import { describe, expect, it } from "vitest";
import { resolveStreamPresentation } from "./streamPresentation";

describe("S2 workflow-aware stream presentation", () => {
  it("streams interactive Conversation and Manual RV live", () => {
    expect(resolveStreamPresentation({ operationKind: "conversation", workflowContext: "conversation" }).presentation).toBe("live");
    expect(resolveStreamPresentation({ operationKind: "manual_rv_viewer", workflowContext: "manual_rv" }).presentation).toBe("live");
  });

  it("streams RV Session Viewer and live Monitor while keeping Judge structured-final", () => {
    expect(resolveStreamPresentation({ operationKind: "rv_session_viewer", workflowContext: "rv_session" }).presentation).toBe("live");
    expect(resolveStreamPresentation({ operationKind: "live_monitor", workflowContext: "rv_session" }).presentation).toBe("live");
    expect(resolveStreamPresentation({ operationKind: "judge", workflowContext: "rv_session" }).presentation).toBe("structured-final");
    expect(resolveStreamPresentation({ operationKind: "post_reveal_viewer", workflowContext: "rv_session" }).presentation).toBe("structured-final");
  });

  it("keeps Training and Research transport streaming hidden even for Judge and post-Reveal", () => {
    for (const workflowContext of ["training", "research"] as const) {
      for (const operationKind of ["training_blind_viewer", "research_viewer", "judge", "post_reveal_viewer", "post_reveal_monitor"] as const) {
        expect(resolveStreamPresentation({ operationKind, workflowContext }).presentation).toBe("hidden");
      }
    }
  });

  it("keeps background work hidden by default", () => {
    expect(resolveStreamPresentation({ operationKind: "field_guide_update", workflowContext: "background" }).presentation).toBe("hidden");
    expect(resolveStreamPresentation({ operationKind: "viewer_notes_reflection", workflowContext: "background" }).presentation).toBe("hidden");
    expect(resolveStreamPresentation({ operationKind: "judge", workflowContext: "background" }).presentation).toBe("hidden");
    expect(resolveStreamPresentation({ operationKind: "post_reveal_viewer" }).presentation).toBe("hidden");
  });
});

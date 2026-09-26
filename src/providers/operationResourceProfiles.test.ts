import { describe, expect, it } from "vitest";
import {
  getOperationResourceProfile,
  inferOperationKind,
  learningObjectOutputAllowance,
  resolveOperationResourceProfile,
  type OperationKind,
  type OperationTimeoutClass,
} from "./operationResourceProfiles";

describe("ORP1 operation resource profiles", () => {
  it("keeps configured/frozen Viewer work on default-auto capacity routing", () => {
    for (const kind of ["conversation", "manual_rv_viewer", "rv_session_viewer", "training_blind_viewer", "research_viewer"] as const) {
      const profile = getOperationResourceProfile(kind);
      expect(profile.outputPolicy).toBe("configured_or_frozen");
      expect(profile.reasoningPolicy).toBe("preserve_configured");
      expect(profile.capacityRoutingPolicy).toBe("default_auto");
    }
  });

  it("keeps live Monitor behavior separate from learning-object policy", () => {
    expect(getOperationResourceProfile("live_monitor")).toMatchObject({
      outputPolicy: "live_monitor",
      reasoningPolicy: "preserve_monitor_behavior",
      retryClass: "monitor_output_recovery",
      capacityRoutingPolicy: "default_auto",
    });
  });

  it("protects Judge and post-Reveal analytical work without shrinking their analytical policy", () => {
    for (const kind of ["judge", "post_reveal_viewer", "post_reveal_monitor"] as const) {
      expect(getOperationResourceProfile(kind)).toMatchObject({
        outputPolicy: "reasoning_heavy_analytical",
        reasoningPolicy: "substantial_headroom",
        capacityRoutingPolicy: "prefer_verified_fit",
      });
    }
  });

  it("maps every operation to the agreed timeout semantic class before S1 assigns durations", () => {
    const expected: Record<OperationKind, OperationTimeoutClass> = {
      conversation: "interactive",
      manual_rv_viewer: "interactive",
      rv_session_viewer: "interactive",
      training_blind_viewer: "interactive",
      research_viewer: "interactive",
      live_monitor: "interactive",
      judge: "long_reasoning",
      post_reveal_viewer: "analytical",
      post_reveal_monitor: "analytical",
      field_guide_update: "long_reasoning",
      viewer_notes_reflection: "long_reasoning",
      generic_provider_call: "interactive",
    };

    for (const [kind, timeoutClass] of Object.entries(expected) as [OperationKind, OperationTimeoutClass][]) {
      expect(getOperationResourceProfile(kind).timeoutClass).toBe(timeoutClass);
    }
  });

  it("marks Field Guide and Viewer Notes as hidden capacity-bound learning objects", () => {
    for (const kind of ["field_guide_update", "viewer_notes_reflection"] as const) {
      expect(getOperationResourceProfile(kind)).toMatchObject({
        outputPolicy: "capacity_bound_learning_object",
        reasoningPolicy: "bounded_learning_object",
        streamPresentation: "hidden",
        capacityRoutingPolicy: "prefer_verified_fit",
      });
    }
  });

  it("adds exactly 8192/16384 tokens of generation headroom above every supported learning-object capacity", () => {
    for (const capacity of [1024, 2048, 4096, 8192]) {
      expect(learningObjectOutputAllowance(capacity, 0)).toBe(capacity + 8192);
      expect(learningObjectOutputAllowance(capacity, 1)).toBe(capacity + 16384);
    }
  });

  it("maps provider operation IDs centrally and permits explicit Training/Research overrides", () => {
    expect(inferOperationKind("chat.conversation")).toBe("conversation");
    expect(inferOperationKind("session.rv-lite")).toBe("rv_session_viewer");
    expect(inferOperationKind("monitor.output-recovery")).toBe("live_monitor");
    expect(inferOperationKind("judge.evaluate")).toBe("judge");
    expect(inferOperationKind("post-reveal.viewer")).toBe("post_reveal_viewer");
    expect(inferOperationKind("field-guide.capacity-retry")).toBe("field_guide_update");
    expect(inferOperationKind("viewer-notes.json-repair")).toBe("viewer_notes_reflection");
    expect(resolveOperationResourceProfile({ operationId: "session.rv-lite", operationKind: "training_blind_viewer" }).operationKind).toBe("training_blind_viewer");
    expect(resolveOperationResourceProfile({ operationId: "session.rcp", operationKind: "research_viewer" }).streamPresentation).toBe("hidden");
  });
});

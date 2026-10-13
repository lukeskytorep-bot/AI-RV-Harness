import { expect, it } from "vitest";
import { telepathicExecutionPresentation, type TelepathicLocalExecution } from "./executionPresentation";

const execution: TelepathicLocalExecution = { seriesId: "s", preexistingCallIds: ["old"] };
const input = { seriesId: "s", status: "running" as const, calls: [{ id: "live", status: "dispatched" as const }], execution, lease: "local" as const };

it("requires the current series, current call, verified local lease and nonterminal state for waiting", () => {
  expect(telepathicExecutionPresentation(input)).toBe("waiting");
  expect(telepathicExecutionPresentation({ ...input, calls: [{ id: "old", status: "dispatched" }] })).toBe("working");
  expect(telepathicExecutionPresentation({ ...input, execution: { ...execution, seriesId: "other" } })).toBe("other");
  expect(telepathicExecutionPresentation({ ...input, lease: "unknown" })).toBe("working");
  for (const status of ["blocked", "cancelled", "completed"] as const) expect(telepathicExecutionPresentation({ ...input, status })).toBe("working");
  expect(telepathicExecutionPresentation({ ...input, status: "completed", calls: [{ ...input.calls[0], callStage: "series_reflection" }] })).toBe("waiting");
});

it("offers recovery only after execution settles and availability is verified", () => {
  expect(telepathicExecutionPresentation({ ...input, calls: [{ id: "live", status: "uncertain" }] })).toBe("working");
  expect(telepathicExecutionPresentation({ ...input, execution: null, lease: "idle" })).toBe("recovery");
  expect(telepathicExecutionPresentation({ ...input, execution: null, lease: "unknown" })).toBe("checking");
  expect(telepathicExecutionPresentation({ ...input, execution: null, lease: "other" })).toBe("other");
  expect(telepathicExecutionPresentation({ ...input, execution: null, lease: "idle", calls: [] })).toBe("idle");
  expect(telepathicExecutionPresentation({ ...input, archivedAt: "t" })).toBe("archived");
});

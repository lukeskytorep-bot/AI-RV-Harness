// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect } from "vitest";
import { TelepathicMetrics } from "./TelepathicMetrics";
import { telepathicRuntimeMetrics } from "../telepathicExchange/runtimeMetrics";
import type { TelepathicProviderCallRecord } from "../telepathicExchange/types";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const call = (id: string, usage?: TelepathicProviderCallRecord["usage"], costSource?: TelepathicProviderCallRecord["costSource"]): TelepathicProviderCallRecord => ({
  id, seriesId: "s", roundId: "r", participantId: "a", callStage: "receiver_first", technicalAttempt: 1,
  status: "succeeded", scopeKey: id, requestSha256: "h", createdAt: "t", updatedAt: "t", usage, costSource,
});

it("shows an unused series at zero without claiming the provider reported a cost", async () => {
  await act(async () => root.render(<TelepathicMetrics pl={false} metrics={telepathicRuntimeMetrics({ providerCalls: [] })} />));
  expect(host.querySelector(".session-run-metrics > span:nth-child(3) strong")?.textContent).toBe("$0.0000");
  expect(host.textContent).not.toContain("provider-reported");
});

for (const pl of [false, true]) {
  it(`renders RV tiles with an explicit known subtotal and request time (${pl ? "PL" : "EN"})`, async () => {
    const metrics = telepathicRuntimeMetrics({ providerCalls: [call("known", { totalTokens: 42, reasoningTokens: 20, costUsd: .01 }, "provider"), call("missing")], activeElapsedMs: 1500 });
    await act(async () => root.render(<TelepathicMetrics pl={pl} metrics={metrics} />));
    const tiles = host.querySelectorAll(".session-run-metrics > span"); expect(tiles).toHaveLength(4);
    expect([...tiles].map(t => t.querySelector("strong")?.textContent)).toEqual(["2", "42", "$0.0100", "1.5 s"]);
    expect(tiles[1].textContent).toContain(pl ? "znana suma" : "known subtotal");
    expect(tiles[2].textContent).toContain(pl ? "zgłoszony przez dostawcę" : "provider-reported");
    expect(tiles[2].textContent).toContain(pl ? "brak pełnych danych: 1 wywołań" : "missing complete data: 1 calls");
    expect(tiles[3].querySelector("small")?.textContent).toBe(pl ? "Czas wywołań" : "Request time");
  });
  it(`does not display unknown tokens or cost as zero (${pl ? "PL" : "EN"})`, async () => {
    await act(async () => root.render(<TelepathicMetrics pl={pl} metrics={telepathicRuntimeMetrics({ providerCalls: [call("missing")] })} />));
    const tiles = host.querySelectorAll(".session-run-metrics > span");
    expect(tiles[1].querySelector("strong")?.textContent).toBe(pl ? "brak danych" : "unavailable");
    expect(tiles[2].querySelector("strong")?.textContent).toBe(pl ? "brak danych" : "unavailable");
    expect(host.textContent).not.toContain("$0.0000");
  });
  it(`identifies estimates without relabelling them provider cost (${pl ? "PL" : "EN"})`, async () => {
    await act(async () => root.render(<TelepathicMetrics pl={pl} metrics={telepathicRuntimeMetrics({ providerCalls: [call("estimated", { totalTokens: 0, costUsd: 0 }, "estimated")] })} />));
    expect(host.textContent).toContain("$0.0000");
    expect(host.textContent).toContain(pl ? "szacunkowy" : "estimated");
    expect(host.textContent).not.toContain(pl ? "zgłoszony przez dostawcę" : "provider-reported");
  });
}

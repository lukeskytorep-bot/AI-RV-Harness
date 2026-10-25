// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { TelepathicTranscript } from "./TelepathicTranscript";
import type { TelepathicTranscriptEvent } from "../telepathicExchange/types";
import type { TelepathicCallPresentation } from "../telepathicExchange/executionPresentation";

const event = (id: string, status: TelepathicTranscriptEvent["providerCallStatus"]): TelepathicTranscriptEvent => ({
  id, seriesId: "s", roundId: "r", sequence: 1, stage: "receiver_first", kind: "materials", authorId: "controller",
  recipientIds: ["a"], text: id, createdAt: "t", providerCallId: id, providerCallStatus: status,
});

async function render(pl: boolean, events: TelepathicTranscriptEvent[], callPresentation?: Record<string, TelepathicCallPresentation>) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(<TelepathicTranscript seriesId="s" roundId="r" leadId="a" participants={[{id:"a",displayName:"A"}]} events={events} pl={pl} callPresentation={callPresentation}/>));
  return { headings: [...container.querySelectorAll(".telepathic-transcript-message small")].map(node => node.textContent),
    async cleanup() { await act(async () => root.unmount()); container.remove(); } };
}

for (const pl of [false, true]) {
  it(`${pl ? "PL" : "EN"}: neutral display applies only to the matching dispatched call`, async () => {
    const view = await render(pl, [event("live", "dispatched"), event("orphan", "dispatched"), event("uncertain", "uncertain"), event("failed", "failed"), event("accepted", "succeeded")],
      { live: "waiting", unrelated: "waiting", uncertain: "waiting", failed: "other", accepted: "checking" });
    try {
      expect(view.headings[0]).toContain(pl ? "Oczekiwanie na odpowiedź" : "Waiting for response");
      for (const index of [1, 2, 3]) expect(view.headings[index]).toContain(pl ? "wysłanie niepotwierdzone" : "delivery unconfirmed");
      expect(view.headings[4]).not.toMatch(/Waiting for response|Oczekiwanie na odpowiedź|unconfirmed|niepotwierdzone|Checking|Sprawdzanie/);
    } finally { await view.cleanup(); }
  });
  it(`${pl ? "PL" : "EN"}: other owner and checking are neutral; absent ownership projection retains recovery`, async () => {
    const view = await render(pl, [event("other", "dispatched"), event("unknown", "dispatched")], { other: "other", unknown: "checking" });
    try {
      expect(view.headings[0]).toContain(pl ? "Praca trwa w innym oknie" : "Work is running in another window");
      expect(view.headings[1]).toContain(pl ? "Sprawdzanie stanu wywołania" : "Checking call state");
      expect(view.headings.join(" ")).not.toMatch(/delivery unconfirmed|wysłanie niepotwierdzone|Waiting for response|Oczekiwanie na odpowiedź/);
    } finally { await view.cleanup(); }
    const orphan = await render(pl, [event("dispatched", "dispatched")]);
    try { expect(orphan.headings[0]).toContain(pl ? "wysłanie niepotwierdzone" : "delivery unconfirmed"); }
    finally { await orphan.cleanup(); }
  });
}

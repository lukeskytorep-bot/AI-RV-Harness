import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SessionEventRecord } from "../sessions/types";
import { BlindTranscriptRecord, buildBlindTranscriptBlocks } from "./BlindTranscriptRecord";

function event(sequenceNumber: number, eventType: string, content: string, metadata?: Record<string, unknown>): SessionEventRecord {
  return { id: `e${sequenceNumber}`, sessionId: "s", sequenceNumber, eventType, content, metadata, createdAt: "now" };
}

describe("BlindTranscriptRecord", () => {
  it("isolates an unclosed Viewer fence from the next phase", () => {
    const events = [
      event(1, "CONTROLLER_STEP", "Instruction four", { phase: 4 }),
      event(2, "VIEWER_RESPONSE", "```text\nunfinished drawing\n| X |", { phase: 4 }),
      event(3, "CONTROLLER_STEP", "**Instruction five**", { phase: 5 }),
      event(4, "VIEWER_RESPONSE", "**Visible next response**", { phase: 5 }),
    ];
    const html = renderToStaticMarkup(<BlindTranscriptRecord events={events} fallbackTranscript="" interfaceLanguage="en" sessionLanguage="en" />);
    expect(html).toContain(">Phase 5</h5>");
    expect(html).toContain("<strong>Instruction five</strong>");
    expect(html).toContain("<strong>Visible next response</strong>");
  });

  it("shows incomplete attempts as their own presentation block", () => {
    const events = [event(1, "VIEWER_OUTPUT_INCOMPLETE", "partial viewer evidence")];
    const blocks = buildBlindTranscriptBlocks(events, "en");
    expect(blocks).toEqual([expect.objectContaining({ kind: "partial", content: "partial viewer evidence" })]);
  });

  it("uses a literal legacy fallback rather than parsing an ambiguous combined transcript", () => {
    const legacy = "```text\nopen fence\n\n## Phase 5\n\n**must remain source text**";
    const html = renderToStaticMarkup(<BlindTranscriptRecord events={[]} fallbackTranscript={legacy} interfaceLanguage="en" sessionLanguage="en" />);
    expect(html).toContain("<pre");
    expect(html).toContain("## Phase 5");
    expect(html).not.toContain("<h2>Phase 5</h2>");
  });
  it("builds RV Lite and Telepathic step headings from event metadata", () => {
    const events = [
      event(1, "CONTROLLER_STEP", "Lite instruction", { promptNumber: 3 }),
      event(2, "CONTROLLER_STEP", "Telepathic question", { step: 8, questionNumber: 2 }),
    ];
    const blocks = buildBlindTranscriptBlocks(events, "en");
    expect(blocks[0]).toEqual(expect.objectContaining({ heading: "RV Lite — Step 3" }));
    expect(blocks[1]).toEqual(expect.objectContaining({ heading: "Telepathic — Step 8 · Question 2" }));
  });

  it("keeps a stored legacy transcript visible when the event set only contains an incomplete attempt", () => {
    const legacy = "Earlier accepted Phase 1 evidence preserved in the sealed transcript.";
    const events = [event(7, "VIEWER_OUTPUT_INCOMPLETE", "partial attempt", { phase: 2 })];
    const html = renderToStaticMarkup(<BlindTranscriptRecord events={events} fallbackTranscript={legacy} interfaceLanguage="en" sessionLanguage="en" />);
    expect(html).toContain(legacy);
    expect(html).toContain("partial attempt");
    expect(html).toContain("Phase 2");
  });

  it("keeps the stored transcript when events cover only an accepted prefix", () => {
    const legacy = "Phase 1 instruction and answer.\nPhase 2 instruction and answer.\nPhase 3 instruction and answer.";
    const events = [
      event(1, "CONTROLLER_STEP", "Phase 1 instruction", { phase: 1 }),
      event(2, "VIEWER_RESPONSE", "Phase 1 answer", { phase: 1, accepted: true, finishReason: "stop" }),
      event(3, "PRE_REVEAL_SEALED", ""),
    ];
    const html = renderToStaticMarkup(<BlindTranscriptRecord events={events} fallbackTranscript={legacy} interfaceLanguage="en" sessionLanguage="en" />);
    expect(html).toContain(legacy);
  });

  it("does not count rejected or length-limited Viewer output as accepted coverage", () => {
    const legacy = "Stored complete blind transcript that must remain visible.";
    for (const metadata of [{ accepted: false, finishReason: "stop" }, { accepted: true, finishReason: "length" }]) {
      const events = [
        event(1, "CONTROLLER_STEP", "Instruction", { phase: 1 }),
        event(2, "VIEWER_RESPONSE", "partial", { phase: 1, ...metadata }),
        event(3, "PRE_REVEAL_SEALED", ""),
      ];
      const html = renderToStaticMarkup(<BlindTranscriptRecord events={events} fallbackTranscript={legacy} interfaceLanguage="en" sessionLanguage="en" />);
      expect(html).toContain(legacy);
    }
  });

  it("labels custom protocol steps as Custom protocol rather than Telepathic", () => {
    const blocks = buildBlindTranscriptBlocks([event(1, "CONTROLLER_STEP", "Custom instruction", { step: 2, customProtocol: "cp-v1" })], "en");
    expect(blocks[0]).toEqual(expect.objectContaining({ heading: "Custom protocol — Step 2" }));
  });


  it("keeps fallback when a long accepted phase is followed by a missing short phase", () => {
    const phase1Prompt = "Long instruction " + "A".repeat(600);
    const phase1Response = "Long response " + "B".repeat(1200);
    const legacy = `## Phase 1\n\n### Exact controller instruction\n\n${phase1Prompt}\n\n### Viewer response\n\n${phase1Response}\n\n## Phase 2\n\n### Exact controller instruction\n\nShort instruction\n\n### Viewer response\n\nShort answer`;
    const events = [
      event(1, "CONTROLLER_STEP", phase1Prompt, { phase: 1 }),
      event(2, "VIEWER_RESPONSE", phase1Response, { phase: 1, accepted: true, finishReason: "stop" }),
    ];
    const html = renderToStaticMarkup(<BlindTranscriptRecord events={events} fallbackTranscript={legacy} interfaceLanguage="en" sessionLanguage="en" />);
    expect(html).toContain("Stored transcript (legacy compatibility)");
    expect(html).toContain("Short answer");
  });

  it("does not duplicate a complete live RCP transcript before sealing", () => {
    const legacy = "## Phase 1\n\n### Exact controller instruction\n\nInstruction\n\n### Viewer response\n\nAnswer";
    const events = [
      event(1, "CONTROLLER_STEP", "Instruction", { phase: 1 }),
      event(2, "VIEWER_RESPONSE", "Answer", { phase: 1, accepted: true, finishReason: "stop" }),
    ];
    const html = renderToStaticMarkup(<BlindTranscriptRecord events={events} fallbackTranscript={legacy} interfaceLanguage="en" sessionLanguage="en" />);
    expect(html).not.toContain("Stored transcript (legacy compatibility)");
    expect((html.match(/Answer/g) ?? []).length).toBe(1);
  });

  it("keeps an incomplete first attempt separate when recovery succeeds", () => {
    const legacy = "## Phase 1\n\n### Exact controller instruction\n\nInstruction\n\n### Viewer response\n\nRecovered answer";
    const events = [
      event(1, "CONTROLLER_STEP", "Instruction", { phase: 1 }),
      event(2, "VIEWER_OUTPUT_INCOMPLETE", "Partial answer", { phase: 1, accepted: false, finishReason: "length" }),
      event(3, "VIEWER_RESPONSE", "Recovered answer", { phase: 1, accepted: true, finishReason: "stop" }),
    ];
    const html = renderToStaticMarkup(<BlindTranscriptRecord events={events} fallbackTranscript={legacy} interfaceLanguage="en" sessionLanguage="en" />);
    expect(html).not.toContain("Stored transcript (legacy compatibility)");
    expect(html).toContain("Partial answer");
    expect(html).toContain("Recovered answer");
  });

  it("matches live transcripts for Lite, Custom and Telepathic without fallback duplication", () => {
    const cases: Array<{ events: SessionEventRecord[]; transcript: string }> = [
      {
        events: [
          event(1, "CONTROLLER_STEP", "Lite instruction", { promptNumber: 1 }),
          event(2, "VIEWER_OUTPUT_INCOMPLETE", "Lite partial", { promptNumber: 1, accepted: false, finishReason: "length" }),
          event(3, "VIEWER_RESPONSE", "Lite answer", { promptNumber: 1, accepted: true, finishReason: "stop" }),
        ],
        transcript: "## RV Lite — Step 1\n\n### Exact controller instruction\n\nLite instruction\n\n### Viewer response\n\nLite answer",
      },
      {
        events: [
          event(1, "CONTROLLER_STEP", "Custom instruction", { step: 1, customProtocol: "cp-v1" }),
          event(2, "VIEWER_OUTPUT_INCOMPLETE", "Custom partial", { step: 1, accepted: false, finishReason: "length" }),
          event(3, "VIEWER_RESPONSE", "Custom answer", { step: 1, accepted: true, finishReason: "stop" }),
        ],
        transcript: "## Custom protocol — Step 1\n\n### Exact controller instruction\n\nCustom instruction\n\n### Viewer response\n\nCustom answer",
      },
      {
        events: [
          event(1, "CONTROLLER_STEP", "Telepathic instruction", { step: 1, telepathicPhase: "T0-T1", protocolFamily: "telepathic" }),
          event(2, "VIEWER_OUTPUT_INCOMPLETE", "Telepathic partial", { step: 1, accepted: false, finishReason: "length" }),
          event(3, "VIEWER_RESPONSE", "Telepathic answer", { step: 1, telepathicPhase: "T0-T1", accepted: true, finishReason: "stop" }),
        ],
        transcript: "## Telepathic Protocol — Step 1 (T0–T1)\n\n### Exact controller instruction\n\nTelepathic instruction\n\n### Viewer response\n\nTelepathic answer",
      },
    ];

    for (const fixture of cases) {
      const html = renderToStaticMarkup(<BlindTranscriptRecord events={fixture.events} fallbackTranscript={fixture.transcript} interfaceLanguage="en" sessionLanguage="en" />);
      expect(html).not.toContain("Stored transcript (legacy compatibility)");
    }
  });

  it("uses session language for reconstruction when an English session is inspected in a Polish interface", () => {
    const transcript = "## Phase 1\n\n### Exact controller instruction\n\nInstruction\n\n### Viewer response\n\nAnswer";
    const events = [
      event(1, "CONTROLLER_STEP", "Instruction", { phase: 1 }),
      event(2, "VIEWER_RESPONSE", "Answer", { phase: 1, accepted: true, finishReason: "stop" }),
    ];
    const html = renderToStaticMarkup(<BlindTranscriptRecord events={events} fallbackTranscript={transcript} interfaceLanguage="pl" sessionLanguage="en" />);
    expect(html).not.toContain("Zapisany transkrypt (zgodność historyczna)");
    expect(html).toContain("Faza 1");
    expect((html.match(/Answer/g) ?? []).length).toBe(1);
  });

  it("uses session language for reconstruction when a Polish session is inspected in an English interface", () => {
    const transcript = "## Faza 1\n\n### Dokładne polecenie kontrolera\n\nPolecenie\n\n### Odpowiedź Viewera\n\nOdpowiedź";
    const events = [
      event(1, "CONTROLLER_STEP", "Polecenie", { phase: 1 }),
      event(2, "VIEWER_RESPONSE", "Odpowiedź", { phase: 1, accepted: true, finishReason: "stop" }),
    ];
    const html = renderToStaticMarkup(<BlindTranscriptRecord events={events} fallbackTranscript={transcript} interfaceLanguage="en" sessionLanguage="pl" />);
    expect(html).not.toContain("Stored transcript (legacy compatibility)");
    expect(html).toContain("Phase 1");
    expect((html.match(/Odpowiedź/g) ?? []).length).toBe(1);
  });

  it("keeps the literal fallback when a legacy session has no snapshot language", () => {
    const transcript = "## Phase 1\n\n### Exact controller instruction\n\nInstruction\n\n### Viewer response\n\nAnswer";
    const events = [
      event(1, "CONTROLLER_STEP", "Instruction", { phase: 1 }),
      event(2, "VIEWER_RESPONSE", "Answer", { phase: 1, accepted: true, finishReason: "stop" }),
    ];
    const html = renderToStaticMarkup(<BlindTranscriptRecord events={events} fallbackTranscript={transcript} interfaceLanguage="pl" />);
    expect(html).toContain("Zapisany transkrypt (zgodność historyczna)");
    expect(html).toContain("## Phase 1");
  });

});

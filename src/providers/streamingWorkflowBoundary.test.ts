import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

describe("S2 streaming workflow boundaries", () => {
  it("keeps Conversation and Manual RV live output provisional until the final chat append", () => {
    const panel = read("src/features/conversations/ChatPanel.tsx");
    const messages = read("src/chat/ChatMessageList.tsx");
    const engine = read("src/chat/engine.ts");
    expect(panel).toContain("streamingAssistant");
    expect(panel).toContain("onStreamEvent: handleVisibleStreamEvent");
    expect(messages).toContain("provisional-stream");
    expect(engine).toContain('streamWorkflowContext: input.mode === "conversation" ? "conversation" : "manual_rv"');
    expect(engine.indexOf("onStreamEvent: input.onStreamEvent")).toBeLessThan(engine.indexOf('appendChatMessage(input.threadId, "assistant"'));
  });

  it("keeps RV Session Viewer and Monitor previews ephemeral while durable transcript writes remain controller-owned", () => {
    const preview = read("src/sessions/streamingPreview.ts");
    const panel = read("src/features/rvSessions/RvSessionPanel.tsx");
    const controller = read("src/sessions/controller.ts");
    expect(preview).not.toContain("repository");
    expect(panel).toContain("onStreamPreview: setStreamPreview");
    expect(panel).toContain("session-stream-preview");
    expect(controller).toContain('role: "viewer"');
    expect(controller).toContain('role: "monitor"');
    expect(controller).toContain("updatePreRevealTranscript");
  });

  it("keeps Training and Research transport streaming hidden", () => {
    const training = read("src/features/training/trainingExecution.ts");
    const research = read("src/research/engine.ts");
    expect(training).toContain('streamWorkflowContext: "training"');
    expect(research).toContain('streamWorkflowContext: "research"');
    expect(training).not.toContain("onStreamPreview");
    expect(research).not.toContain("onStreamPreview");
  });

  it("keeps Judge structured-final in RV Sessions and hidden in Research/Training", () => {
    const judgeUi = read("src/features/judge/JudgeEvaluation.tsx");
    const training = read("src/features/training/trainingExecution.ts");
    const research = read("src/research/engine.ts");
    const resolver = read("src/providers/streamPresentation.ts");
    expect(judgeUi).toContain('streamWorkflowContext: "rv_session"');
    expect(training).toContain('streamWorkflowContext: "training"');
    expect(research).toContain('streamWorkflowContext: "research"');
    expect(resolver).toContain('presentation = "structured-final"');
    expect(resolver).toContain('presentation = "hidden"');
  });

  it("never exposes provider continuation payloads through the UI stream channel", () => {
    const rust = read("src-tauri/src/providers/streaming.rs");
    const types = read("src/providers/types.ts");
    expect(rust).toContain("ProviderStreamEvent::ContentDelta");
    expect(rust).not.toContain("ProviderStreamEvent::ReasoningDelta");
    expect(rust).not.toContain("ProviderStreamEvent::ReasoningDetails");
    expect(types).not.toContain('event: "reasoningDelta"');
    expect(types).not.toContain('event: "reasoningDetailsDelta"');
  });
});

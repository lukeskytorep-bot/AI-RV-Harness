import { describe, expect, it, vi } from "vitest";
import { sendPostRevealTurn } from "./postReveal";
import type { ProviderConfig, ProviderModel } from "../providers/types";

const config: ProviderConfig = { id: "pc", provider: "openrouter", label: "P", credentialId: "cred", enabled: true, createdAt: "now", updatedAt: "now" };
const model: ProviderModel = { providerConfigId: "pc", provider: "openrouter", modelId: "viewer", displayName: "Viewer", route: "openrouter:viewer", capabilities: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], contextTokens: 100_000, maxOutputTokens: 4096, source: "provider", capturedAt: "now" }, pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "now" };

describe("post-reveal discussion", () => {
  it("persists after-feedback turns separately and labels sealed evidence read-only", async () => {
    let transcript = "";
    const repository = {
      getSessionSnapshot: vi.fn().mockResolvedValue({ providerConfigId: "pc", modelId: "viewer", sessionLanguage: "en" }),
      getReveal: vi.fn().mockResolvedValue({ source: "external_text", text: "Stone lighthouse", hash: "h" }),
      getViewerEvidence: vi.fn().mockResolvedValue("tall hard structure"),
      listTargetClarifications: vi.fn().mockResolvedValue([]),
      appendPostRevealTurn: vi.fn(async (_id: string, role: "user" | "assistant" | "monitor", content: string) => {
        transcript += `${JSON.stringify({ role, content })}\n`;
        return transcript;
      }),
    };
    const chat = vi.fn(async ({ messages }) => ({ content: "My blind structure description overlaps the lighthouse shape.", usage: {}, messages }));
    const result = await sendPostRevealTurn({ repository, sessionId: "s", existingTranscript: "", providerConfig: config, model, content: "Compare my session with the feedback.", chat });
    const request = chat.mock.calls[0][0];
    expect(JSON.stringify(request.messages)).toContain("SEALED PRE-REVEAL EVIDENCE — READ ONLY");
    expect(JSON.stringify(request.messages)).toContain("Stone lighthouse");
    expect(repository.appendPostRevealTurn).toHaveBeenNthCalledWith(1, "s", "user", "Compare my session with the feedback.");
    expect(repository.appendPostRevealTurn).toHaveBeenNthCalledWith(2, "s", "assistant", expect.stringContaining("lighthouse"));
    expect(result.transcript).toContain('"role":"assistant"');
  });
});

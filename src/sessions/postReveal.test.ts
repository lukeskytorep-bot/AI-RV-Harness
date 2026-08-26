import { describe, expect, it, vi } from "vitest";
import { runAutomaticPostRevealReview, sendPostRevealTurn } from "./postReveal";
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

  it("automatically stores the Viewer review first and the Monitor review second", async () => {
    let transcript = "";
    const repository = {
      getSessionSnapshot: vi.fn().mockResolvedValue({
        providerConfigId: "pc", modelId: "viewer", sessionLanguage: "pl", workspaceId: "workspace",
        monitor: { providerConfigId: "pc-monitor", modelId: "monitor", effectivePrompt: "Monitor prompt" },
      }),
      getReveal: vi.fn().mockResolvedValue({ source: "external_text", text: "Kamienna latarnia", hash: "h" }),
      getViewerEvidence: vi.fn().mockResolvedValue("twarda wysoka struktura"),
      listTargetClarifications: vi.fn().mockResolvedValue([]),
      listMonitorRuns: vi.fn().mockResolvedValue([{ id: "run", sessionId: "s" }]),
      listMonitorInterventions: vi.fn().mockResolvedValue([{ sequenceNumber: 1, decision: "intervene", commandText: "Opisz strukturę." }]),
      appendPostRevealTurn: vi.fn(async (_id: string, role: "user" | "assistant" | "monitor", content: string) => {
        transcript += `${JSON.stringify({ role, content })}\n`;
        return transcript;
      }),
    };
    const monitorConfig: ProviderConfig = { ...config, id: "pc-monitor", label: "Monitor" };
    const monitorModel: ProviderModel = { ...model, providerConfigId: "pc-monitor", modelId: "monitor", displayName: "Monitor", route: "openrouter:monitor" };
    const chat = vi.fn(async ({ config: usedConfig }: { config: ProviderConfig }) => ({ content: usedConfig.id === "pc" ? "Ocena Viewera" : "Ocena Monitora", usage: {} }));

    const result = await runAutomaticPostRevealReview({
      repository: repository as never,
      sessionId: "s",
      viewer: { providerConfig: config, model },
      monitor: { providerConfig: monitorConfig, model: monitorModel },
      chat: chat as never,
    });

    expect(repository.appendPostRevealTurn).toHaveBeenNthCalledWith(1, "s", "user", expect.stringContaining("co poszło dobrze"));
    expect(repository.appendPostRevealTurn).toHaveBeenNthCalledWith(2, "s", "assistant", "Ocena Viewera");
    expect(repository.appendPostRevealTurn).toHaveBeenNthCalledWith(3, "s", "monitor", "Ocena Monitora");
    expect(result).toContain('"role":"monitor"');
  });

  it("keeps the already persisted Viewer review when the Monitor call fails", async () => {
    let transcript = "";
    const repository = {
      getSessionSnapshot: vi.fn().mockResolvedValue({
        providerConfigId: "pc", modelId: "viewer", sessionLanguage: "en", workspaceId: "workspace",
        monitor: { providerConfigId: "pc-monitor", modelId: "monitor", effectivePrompt: "Monitor prompt" },
      }),
      getReveal: vi.fn().mockResolvedValue({ source: "external_text", text: "Lighthouse", hash: "h" }),
      getViewerEvidence: vi.fn().mockResolvedValue("tall hard structure"),
      listTargetClarifications: vi.fn().mockResolvedValue([]),
      listMonitorRuns: vi.fn().mockResolvedValue([{ id: "run", sessionId: "s" }]),
      listMonitorInterventions: vi.fn().mockResolvedValue([]),
      appendPostRevealTurn: vi.fn(async (_id: string, role: "user" | "assistant" | "monitor", content: string) => {
        transcript += `${JSON.stringify({ role, content })}\n`;
        return transcript;
      }),
    };
    const monitorConfig: ProviderConfig = { ...config, id: "pc-monitor", label: "Monitor" };
    const monitorModel: ProviderModel = { ...model, providerConfigId: "pc-monitor", modelId: "monitor", displayName: "Monitor", route: "openrouter:monitor" };
    const chat = vi.fn(async ({ config: usedConfig }: { config: ProviderConfig }) => {
      if (usedConfig.id === "pc-monitor") throw new Error("monitor unavailable");
      return { content: "Viewer review remains saved", usage: {} };
    });
    await expect(runAutomaticPostRevealReview({ repository: repository as never, sessionId: "s", viewer: { providerConfig: config, model }, monitor: { providerConfig: monitorConfig, model: monitorModel }, chat: chat as never })).rejects.toThrow("monitor unavailable");
    expect(transcript).toContain("Viewer review remains saved");
    expect(transcript).not.toContain('"role":"monitor"');
  });
});

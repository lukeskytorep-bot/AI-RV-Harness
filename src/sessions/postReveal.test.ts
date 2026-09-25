import { describe, expect, it, vi } from "vitest";

vi.mock("../providers/native", () => ({
  discoverOpenRouterModelEndpoints: vi.fn(async () => ({ data: { endpoints: [
    { tag: "test/large", context_length: 262_144, max_completion_tokens: 32_768 },
  ] } })),
  providerChatAttempt: vi.fn(),
}));
import { automaticPostRevealReviewRequest, findCompletedAutomaticViewerReview, findCompletedAutomaticViewerReviewRecord, runAutomaticPostRevealReview, sendPostRevealTurn, supportedAutomaticPostRevealReviewRequests } from "./postReveal";
import type { ProviderConfig, ProviderMessage, ProviderModel } from "../providers/types";
import { ProviderCallError } from "../providers/providerError";
import { captureOpenRouterContinuationState } from "../providers/openRouterContinuation";
import { serializePostRevealTurn } from "./postRevealTranscript";

const config: ProviderConfig = { id: "pc", provider: "openrouter", label: "P", credentialId: "cred", enabled: true, createdAt: "now", updatedAt: "now" };
const model: ProviderModel = { providerConfigId: "pc", provider: "openrouter", modelId: "viewer", displayName: "Viewer", route: "openrouter:viewer", capabilities: { inputModalities: ["text"], outputModalities: ["text"], supportsVision: false, supportsStreaming: true, reasoning: { supported: false, efforts: [], confidence: "unknown" }, temperature: { supported: false, confidence: "unknown" }, supportedParameters: [], contextTokens: 100_000, maxOutputTokens: 4096, source: "provider", capturedAt: "now" }, pricing: {}, recommended: false, rawMetadata: {}, refreshedAt: "now" };

describe("post-reveal discussion", () => {
  const expectedPolishRequest = `Dziękuję za wykonaną sesję — świetna robota. Część ślepa została zakończona i zapieczętowana. Teraz przechodzimy do ujawnienia celu.

Porównaj zapieczętowany zapis części ślepej z ujawnionym celem. Wskaż konkretnie: co było trafne, częściowo trafne lub nietrafne, co warto poprawić w następnych sesjach oraz co już działa dobrze.

Pamiętaj, że Reveal może nie opisywać wyczerpująco całego otoczenia celu. Szczegół zgodny z celem lub jego bezpośrednim otoczeniem, lecz niepotwierdzony w Revealu, oznacz jako prawdopodobną, ale niezweryfikowaną zgodność kontekstową — nie jako potwierdzone trafienie ani błąd. Największą wagę przypisuj opisowi głównego celu; trafne otoczenie traktuj jako mniej ważne wsparcie. Informacje sprzeczne z Revelem uznaj za nietrafne i nie zawyżaj oceny na podstawie samej wiedzy ogólnej.

Opisz również własne doświadczenie percepcyjne z tej sesji. Wskaż, jakie wrażenia, odczucia i cechy pola towarzyszyły elementom, które po Revealu okazały się trafnie, częściowo trafnie lub nietrafnie rozpoznane. Zaznacz, które sygnały pomogły Ci rozróżnić elementy celu, które były niejasne albo mylące oraz czy zauważyłeś cechy percepcyjne niewystępujące wcześniej w Twoich wskazówkach. Na tym etapie przedstaw wyłącznie obserwacje wynikające z własnego doświadczenia w tej sesji.

Wyraźnie oddziel analizę po Revealu od wcześniejszych danych blind i nie dopisuj nowych percepcji do zapieczętowanej części sesji.`;
  const expectedEnglishRequest = `Thank you for completing the session — excellent work. The blind portion has ended and has been sealed. We will now proceed to the target Reveal.

Compare the sealed blind-session record with the revealed target. Identify specifically what was accurate, partly accurate, or inaccurate, what should be improved in future sessions, and what already works well.

Remember that the Reveal may not exhaustively describe the target’s entire surroundings. A detail consistent with the target or its immediate surroundings but not confirmed by the Reveal should be classified as plausible but unverified contextual correspondence—not as either a confirmed hit or an error. Give the greatest weight to the principal target and treat accurate surrounding context as lower-weight supporting evidence. Treat details contradicted by the Reveal as inaccurate, and do not inflate the assessment using general knowledge alone.

Also describe your own perceptual experience during this session. Identify what impressions, sensations, and field characteristics accompanied elements that, after the Reveal, proved accurately, partly accurately, or inaccurately recognized. Indicate which signals helped you distinguish target elements, which were unclear or misleading, and whether you noticed perceptual characteristics not previously represented in your guidance. At this stage, provide only observations grounded in your own experience during this session.

Clearly separate this post-Reveal analysis from the earlier blind data and do not add new perceptions to the sealed session record.`;

  it("returns the exact canonical Polish automatic Viewer review request", () => {
    expect(automaticPostRevealReviewRequest("pl")).toBe(expectedPolishRequest);
  });

  it("returns the exact canonical English automatic Viewer review request", () => {
    expect(automaticPostRevealReviewRequest("en")).toBe(expectedEnglishRequest);
  });

  it("adds the courtesy transition exactly once", () => {
    expect(automaticPostRevealReviewRequest("pl").split("Dziękuję za wykonaną sesję — świetna robota.")).toHaveLength(2);
    expect(automaticPostRevealReviewRequest("en").split("Thank you for completing the session — excellent work.")).toHaveLength(2);
  });

  it("adds only the requested perceptual-experience paragraph and never includes the Field Lexicon in Review", () => {
    const pl = automaticPostRevealReviewRequest("pl");
    const en = automaticPostRevealReviewRequest("en");
    expect(pl).toContain("Opisz również własne doświadczenie percepcyjne z tej sesji.");
    expect(en).toContain("Also describe your own perceptual experience during this session.");
    expect(pl).not.toContain("Nie twórz jeszcze nowej wersji Przewodnika Pola");
    expect(en).not.toContain("Do not create a new Field Guide version yet");
    expect(pl).not.toContain("Słownik Percepcyjny Pola");
    expect(en).not.toContain("Field Perception Lexicon");
  });

  it.each(["pl", "en"] as const)("recognizes all historical and current %s automatic Viewer review requests by exact match", (language) => {
    const requests = supportedAutomaticPostRevealReviewRequests(language);
    const [currentRequest] = requests;
    expect(currentRequest).toBe(automaticPostRevealReviewRequest(language));
    expect(requests).toHaveLength(3);

    for (const request of requests) {
      const transcript = `${serializePostRevealTurn("user", request)}${serializePostRevealTurn("assistant", `Stored ${language} review`)}`;
      expect(findCompletedAutomaticViewerReview(transcript, language)).toBe(`Stored ${language} review`);
      expect(findCompletedAutomaticViewerReviewRecord(transcript, language)).toEqual({ request, content: `Stored ${language} review` });
    }

    const incompleteNearMatch = `${serializePostRevealTurn("user", `${currentRequest.slice(0, -1)}?`)}${serializePostRevealTurn("assistant", "Must not match")}`;
    expect(findCompletedAutomaticViewerReview(incompleteNearMatch, language)).toBeNull();
  });
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


  it("rehydrates exact post-Reveal OpenRouter state and atomically stores the next assistant state", async () => {
    const prior = captureOpenRouterContinuationState({
      config,
      requestedModelId: model.modelId,
      normalizedEndpoint: "https://openrouter.ai/api/v1",
      reasoningDetails: [{ type: "reasoning.encrypted", data: "RklYVFVSRQ==", id: "prior", format: "openai-responses-v1", index: 0 }],
    });
    if (!prior.state) throw new Error("Expected prior state.");
    const existingTranscript = `${serializePostRevealTurn("user", "First post-Reveal question")}${serializePostRevealTurn("assistant", "First answer")}`;
    let transcript = existingTranscript;
    const appendPostRevealTurnWithProviderState = vi.fn(async (_id: string, content: string) => {
      transcript += serializePostRevealTurn("assistant", content);
      return transcript;
    });
    const repository = {
      getSessionSnapshot: vi.fn().mockResolvedValue({
        schemaVersion: 4,
        providerConfigId: "pc", credentialId: "cred", provider: "openrouter", modelId: "viewer", modelRoute: "openrouter:viewer", sessionLanguage: "en",
        continuationRoute: { transport: "openrouter", normalizedEndpoint: "https://openrouter.ai/api/v1", providerConfigId: "pc", credentialId: "cred", requestedModelId: "viewer", stateFormat: "openrouter-reasoning-details", stateFormatVersion: 1 },
      }),
      getReveal: vi.fn().mockResolvedValue({ source: "external_text", text: "Lighthouse", hash: "h" }),
      getViewerEvidence: vi.fn().mockResolvedValue("tall hard structure"),
      listTargetClarifications: vi.fn().mockResolvedValue([]),
      listSessionEvents: vi.fn().mockResolvedValue([{
        id: "post-event-1", sessionId: "s", sequenceNumber: 10, createdAt: "now", eventType: "POST_REVEAL_ASSISTANT", role: "assistant", content: "First answer",
        metadata: { continuationState: { status: "stored", format: "openrouter-reasoning-details", version: 1 } },
      }]),
      getSessionEventProviderState: vi.fn().mockResolvedValue({ ownerId: "post-event-1", format: prior.state.format, formatVersion: 1, transport: "openrouter", replayFingerprint: prior.state.replayFingerprint, state: prior.state, payloadSha256: "a".repeat(64), payloadSizeBytes: 1, createdAt: "now" }),
      appendPostRevealTurn: vi.fn(async (_id: string, role: "user" | "assistant" | "monitor", content: string) => {
        transcript += serializePostRevealTurn(role, content);
        return transcript;
      }),
      appendPostRevealTurnWithProviderState,
    };
    const chat = vi.fn(async ({ messages }: { messages: ProviderMessage[] }) => {
      const priorAssistant = messages.find((message) => message.role === "assistant" && message.content === "First answer");
      expect(priorAssistant?.continuationState).toEqual(prior.state);
      return {
        content: "Second answer",
        reasoningDetails: [{ type: "reasoning.encrypted", data: "TkVXU1RBVEU=", id: "next", format: "openai-responses-v1", index: 0 }],
        usage: {},
      };
    });
    await sendPostRevealTurn({ repository: repository as never, sessionId: "s", existingTranscript, providerConfig: config, model, content: "Second question", chat: chat as never });
    expect(appendPostRevealTurnWithProviderState).toHaveBeenCalledTimes(1);
    expect(repository.getSessionEventProviderState).toHaveBeenCalledWith("post-event-1");
  });



  it("fails closed when a frozen post-Reveal assistant turn has no matching Session event", async () => {
    const existingTranscript = `${serializePostRevealTurn("user", "First question")}${serializePostRevealTurn("assistant", "Persisted assistant answer")}`;
    const repository = {
      getSessionSnapshot: vi.fn().mockResolvedValue({
        schemaVersion: 4, providerConfigId: "pc", credentialId: "cred", provider: "openrouter", modelId: "viewer", modelRoute: "openrouter:viewer", sessionLanguage: "en",
        continuationRoute: { transport: "openrouter", normalizedEndpoint: "https://openrouter.ai/api/v1", providerConfigId: "pc", credentialId: "cred", requestedModelId: "viewer", stateFormat: "openrouter-reasoning-details", stateFormatVersion: 1 },
      }),
      getReveal: vi.fn().mockResolvedValue({ source: "external_text", text: "Lighthouse", hash: "h" }),
      getViewerEvidence: vi.fn().mockResolvedValue("tall hard structure"),
      listTargetClarifications: vi.fn().mockResolvedValue([]),
      listSessionEvents: vi.fn().mockResolvedValue([]),
      getSessionEventProviderState: vi.fn(),
      appendPostRevealTurnWithProviderState: vi.fn(),
      appendPostRevealTurn: vi.fn(),
    };
    const chat = vi.fn().mockResolvedValue({ content: "must not run", usage: {} });

    await expect(sendPostRevealTurn({
      repository: repository as never,
      sessionId: "s",
      existingTranscript,
      providerConfig: config,
      model,
      content: "Second question",
      chat: chat as never,
    })).rejects.toThrow("assistant turn without a matching persisted Session event");

    expect(chat).not.toHaveBeenCalled();
    expect(repository.appendPostRevealTurn).not.toHaveBeenCalled();
    expect(repository.getSessionEventProviderState).not.toHaveBeenCalled();
  });

  it("marks malformed post-Reveal state invalid and blocks the next call before dispatch", async () => {
    let transcript = "";
    const events: Array<{ id: string; sessionId: string; sequenceNumber: number; createdAt: string; eventType: string; role?: "assistant"; content?: string; metadata?: Record<string, unknown> }> = [];
    const repository = {
      getSessionSnapshot: vi.fn().mockResolvedValue({
        schemaVersion: 4, providerConfigId: "pc", credentialId: "cred", provider: "openrouter", modelId: "viewer", modelRoute: "openrouter:viewer", sessionLanguage: "en",
        continuationRoute: { transport: "openrouter", normalizedEndpoint: "https://openrouter.ai/api/v1", providerConfigId: "pc", credentialId: "cred", requestedModelId: "viewer", stateFormat: "openrouter-reasoning-details", stateFormatVersion: 1 },
      }),
      getReveal: vi.fn().mockResolvedValue({ source: "external_text", text: "Lighthouse", hash: "h" }),
      getViewerEvidence: vi.fn().mockResolvedValue("tall hard structure"),
      listTargetClarifications: vi.fn().mockResolvedValue([]),
      listSessionEvents: vi.fn(async () => events),
      getSessionEventProviderState: vi.fn().mockResolvedValue(null),
      appendPostRevealTurnWithProviderState: vi.fn(),
      appendPostRevealTurn: vi.fn(async (_id: string, role: "user" | "assistant" | "monitor", content: string, metadata?: Record<string, unknown>) => {
        transcript += serializePostRevealTurn(role, content);
        if (role === "assistant") {
          events.push({ id: `event-${events.length + 1}`, sessionId: "s", sequenceNumber: events.length + 1, createdAt: "now", eventType: "POST_REVEAL_ASSISTANT", role: "assistant", content, metadata });
        }
        return transcript;
      }),
    };
    const malformedChat = vi.fn().mockResolvedValue({
      content: "Visible answer survives",
      reasoningDetails: [{ type: "reasoning.encrypted", data: "not-base64", id: "broken", format: "openai-responses-v1", index: 0 }],
      usage: {},
    });
    await expect(sendPostRevealTurn({ repository: repository as never, sessionId: "s", existingTranscript: "", providerConfig: config, model, content: "First question", chat: malformedChat as never }))
      .rejects.toThrow("failed validation");
    expect(events[0]?.metadata).toEqual(expect.objectContaining({ continuationState: expect.objectContaining({ status: "invalid" }) }));
    expect(transcript).toContain("Visible answer survives");

    const secondChat = vi.fn().mockResolvedValue({ content: "must not run", usage: {} });
    await expect(sendPostRevealTurn({ repository: repository as never, sessionId: "s", existingTranscript: transcript, providerConfig: config, model, content: "Second question", chat: secondChat as never }))
      .rejects.toThrow("invalid OpenRouter continuation state");
    expect(secondChat).not.toHaveBeenCalled();
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
    const order: string[] = [];
    repository.appendPostRevealTurn.mockImplementation(async (_id: string, role: "user" | "assistant" | "monitor", content: string) => {
      order.push(role);
      transcript += `${JSON.stringify({ role, content })}\n`;
      return transcript;
    });

    const result = await runAutomaticPostRevealReview({
      repository: repository as never,
      sessionId: "s",
      viewer: { providerConfig: config, model },
      monitor: { providerConfig: monitorConfig, model: monitorModel },
      chat: chat as never,
      afterViewerReview: async ({ content }) => { order.push(`reflection:${content}`); },
    });

    expect(repository.appendPostRevealTurn).toHaveBeenNthCalledWith(1, "s", "user", automaticPostRevealReviewRequest("pl"));
    expect(repository.appendPostRevealTurn).toHaveBeenNthCalledWith(2, "s", "assistant", "Ocena Viewera");
    expect(repository.appendPostRevealTurn).toHaveBeenNthCalledWith(3, "s", "monitor", "Ocena Monitora");
    expect(order).toEqual(["user", "assistant", "reflection:Ocena Viewera", "monitor"]);
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

  it("retries one reasoning-only Viewer review without duplicating the persisted user turn", async () => {
    let transcript = "";
    const repository = {
      getSessionSnapshot: vi.fn().mockResolvedValue({ providerConfigId: "pc", modelId: "viewer", sessionLanguage: "en", generationSettings: { requested: { reasoningEffort: "high" } } }),
      getReveal: vi.fn().mockResolvedValue({ source: "external_text", text: "Lighthouse", hash: "h" }),
      getViewerEvidence: vi.fn().mockResolvedValue("tall hard structure"),
      listTargetClarifications: vi.fn().mockResolvedValue([]),
      appendPostRevealTurn: vi.fn(async (_id: string, role: "user" | "assistant" | "monitor", content: string) => {
        transcript += `${JSON.stringify({ role, content })}\n`;
        return transcript;
      }),
    };
    const highCapacityModel: ProviderModel = { ...model, capabilities: { ...model.capabilities, maxOutputTokens: 16_384 } };
    const chat = vi.fn()
      .mockRejectedValueOnce(new Error("provider returned reasoning without a final assistant response [finish-reason=length]"))
      .mockResolvedValueOnce({ content: "Complete Viewer review", finishReason: "stop", usage: {} });
    await sendPostRevealTurn({ repository, sessionId: "s", existingTranscript: "", providerConfig: config, model: highCapacityModel, content: "Review the session.", chat });
    expect(chat.mock.calls.map((call) => call[0].settings.effective.maxOutputTokens)).toEqual([8192, 16384]);
    expect(repository.appendPostRevealTurn.mock.calls.filter((call) => call[1] === "user")).toHaveLength(1);
    expect(repository.appendPostRevealTurn.mock.calls.filter((call) => call[1] === "assistant")).toHaveLength(1);
  });

  it("retries a Viewer body-read failure without duplicating either persisted turn", async () => {
    let transcript = "";
    const repository = {
      getSessionSnapshot: vi.fn().mockResolvedValue({ providerConfigId: "pc", modelId: "viewer", sessionLanguage: "en" }),
      getReveal: vi.fn().mockResolvedValue({ source: "external_text", text: "Lighthouse", hash: "h" }),
      getViewerEvidence: vi.fn().mockResolvedValue("tall hard structure"),
      listTargetClarifications: vi.fn().mockResolvedValue([]),
      appendPostRevealTurn: vi.fn(async (_id: string, role: "user" | "assistant" | "monitor", content: string) => {
        transcript += `${JSON.stringify({ role, content })}\n`;
        return transcript;
      }),
    };
    const chat = vi.fn()
      .mockRejectedValueOnce(new ProviderCallError({ code: "response_body_read", message: "body closed", phase: "reading_body" }))
      .mockResolvedValueOnce({ content: "Recovered review", usage: {} });
    await sendPostRevealTurn({ repository, sessionId: "s", existingTranscript: "", providerConfig: config, model, content: "Review.", maxRetries: 5, chat });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(repository.appendPostRevealTurn.mock.calls.filter((call) => call[1] === "user")).toHaveLength(1);
    expect(repository.appendPostRevealTurn.mock.calls.filter((call) => call[1] === "assistant")).toHaveLength(1);
  });
});

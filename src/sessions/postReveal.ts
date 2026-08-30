import { loadRevealImageForJudge } from "../artifacts/native";
import { resolveGenerationSettings } from "../providers/capabilities";
import { providerChat as nativeProviderChat } from "../providers/native";
import type { ProviderChatResponse, ProviderConfig, ProviderMessage, ProviderModel } from "../providers/types";
import type { AppRepository } from "../storage/repository";
import { parsePostRevealTranscript } from "./postRevealTranscript";
import { buildEffectiveMonitorPrompt } from "../resources/systemPrompts";
import { politeRevealTransition } from "./courtesy";
import { analyticalOutputBudget, callWithAnalyticalOutputRecovery } from "../providers/outputRecovery";

type PostRevealRepository = Pick<AppRepository, "appendPostRevealTurn" | "getReveal" | "getSessionSnapshot" | "getViewerEvidence" | "listTargetClarifications">;

export async function sendPostRevealTurn(input: {
  repository: PostRevealRepository;
  sessionId: string;
  existingTranscript: string;
  providerConfig: ProviderConfig;
  model: ProviderModel;
  content: string;
  timeoutMs?: number;
  chat?: (request: { config: ProviderConfig; modelId: string; messages: ProviderMessage[]; settings: ReturnType<typeof resolveGenerationSettings>; timeoutMs?: number }) => Promise<ProviderChatResponse>;
}): Promise<{ transcript: string; response: ProviderChatResponse }> {
  const content = input.content.trim();
  if (!content) throw new Error("Post-reveal message cannot be empty.");

  const [snapshot, reveal, evidence, clarifications] = await Promise.all([
    input.repository.getSessionSnapshot(input.sessionId),
    input.repository.getReveal(input.sessionId),
    input.repository.getViewerEvidence(input.sessionId),
    input.repository.listTargetClarifications(input.sessionId),
  ]);
  if (!snapshot || !reveal) throw new Error("Sealed session snapshot and Reveal are required for post-reveal discussion.");
  if (snapshot.providerConfigId !== input.providerConfig.id || snapshot.modelId !== input.model.modelId) {
    throw new Error("Post-reveal discussion must use the Viewer route captured in the Session Snapshot.");
  }

  const imageArtifacts = (reveal.artifactManifest ?? []).filter((artifact) => artifact.mimeType.startsWith("image/"));
  if (imageArtifacts.length && (!input.model.capabilities.supportsVision || !input.model.capabilities.inputModalities.includes("image"))) {
    throw new Error("The original Viewer route cannot receive this image Reveal for post-reveal discussion.");
  }
  const images = await Promise.all(imageArtifacts.map(loadRevealImageForJudge));
  const language = snapshot.sessionLanguage;
  const system = language === "pl"
    ? "To jest wyłącznie rozmowa PO REVEALU. Zapieczętowany materiał pre-reveal jest historycznym dowodem i nie wolno go przepisywać ani przedstawiać nowych obserwacji jako danych z części blind. Możesz porównywać feedback z istniejącym materiałem i omawiać sesję wprost jako analizę po feedbacku."
    : "This is a POST-REVEAL discussion only. The sealed pre-reveal material is historical evidence and must never be rewritten or supplemented with new claims presented as blind data. You may compare feedback with the existing evidence and discuss the session explicitly as after-feedback analysis.";
  const revealText = [
    `[SEALED PRE-REVEAL EVIDENCE — READ ONLY]\n${evidence}`,
    `[ACCEPTED REVEAL]\n${reveal.text?.trim() || "(image Reveal attached)"}`,
    clarifications.length ? `[SUPPLEMENTARY TARGET CLARIFICATIONS — POST-REVEAL ONLY]\n${clarifications.map((item) => item.content).join("\n\n")}` : "",
  ].filter(Boolean).join("\n\n");
  const messages: ProviderMessage[] = [
    { role: "system", content: system },
    { role: "user", content: revealText, ...(images.length ? { images } : {}) },
    ...parsePostRevealTranscript(input.existingTranscript).map((turn) => turn.role === "monitor"
      ? ({ role: "user", content: `[AI MONITOR POST-REVEAL REVIEW]\n${turn.content}` } satisfies ProviderMessage)
      : ({ role: turn.role, content: turn.content } satisfies ProviderMessage)),
    { role: "user", content },
  ];
  analyticalOutputBudget({ model: input.model, messages, attempt: 0 });
  await input.repository.appendPostRevealTurn(input.sessionId, "user", content);
  const response = (await callWithAnalyticalOutputRecovery({
    model: input.model,
    messages,
    requestedSettings: snapshot.generationSettings?.requested,
    call: (settings) => (input.chat ?? nativeProviderChat)({
      config: input.providerConfig,
      modelId: input.model.modelId,
      messages,
      settings,
      timeoutMs: input.timeoutMs,
    }),
  })).response;
  const transcript = await input.repository.appendPostRevealTurn(input.sessionId, "assistant", response.content);
  return { transcript, response };
}

type MonitorPostRevealRepository = Pick<AppRepository, "appendPostRevealTurn" | "getReveal" | "getSessionSnapshot" | "getViewerEvidence" | "listTargetClarifications" | "listMonitorRuns" | "listMonitorInterventions">;

export async function runAutomaticPostRevealReview(input: {
  repository: MonitorPostRevealRepository;
  sessionId: string;
  existingTranscript?: string;
  viewer: { providerConfig: ProviderConfig; model: ProviderModel };
  monitor?: { providerConfig: ProviderConfig; model: ProviderModel };
  timeoutMs?: number;
  chat?: (request: { config: ProviderConfig; modelId: string; messages: ProviderMessage[]; settings: ReturnType<typeof resolveGenerationSettings>; timeoutMs?: number }) => Promise<ProviderChatResponse>;
  afterViewerReview?: (review: { content: string; transcript: string; response: ProviderChatResponse }) => Promise<void>;
}): Promise<string> {
  const snapshot = await input.repository.getSessionSnapshot(input.sessionId);
  if (!snapshot) throw new Error("The captured Session Snapshot is required for the automatic post-Reveal review.");
  const reviewInstruction = snapshot.sessionLanguage === "pl"
    ? "Porównaj teraz zapieczętowany zapis części ślepej z ujawnionym celem. Opisz konkretnie: co poszło dobrze, co poszło źle lub było nietrafne, co było częściowo trafne, co warto poprawić w następnych sesjach oraz co już działa dobrze. Wyraźnie oddziel analizę po Revealu od wcześniejszych danych blind i nie dopisuj nowych percepcji do zapieczętowanej części sesji."
    : "Now compare the sealed blind-session record with the revealed target. Describe specifically: what went well, what was wrong or inaccurate, what was partly accurate, what should be improved in future sessions, and what already works well. Clearly separate this post-Reveal analysis from the earlier blind data and do not add new perceptions to the sealed session record.";
  const request = `${politeRevealTransition(snapshot.sessionLanguage)}\n\n${reviewInstruction}`;
  const viewerResult = await sendPostRevealTurn({
    repository: input.repository,
    sessionId: input.sessionId,
    existingTranscript: input.existingTranscript ?? "",
    providerConfig: input.viewer.providerConfig,
    model: input.viewer.model,
    content: request,
    timeoutMs: input.timeoutMs,
    ...(input.chat ? { chat: input.chat } : {}),
  });
  if (input.afterViewerReview) {
    try {
      await input.afterViewerReview({ content: viewerResult.response.content, transcript: viewerResult.transcript, response: viewerResult.response });
    } catch (cause) {
      console.error("Viewer Notes reflection failed after the Viewer review; Monitor review will continue.", cause);
    }
  }
  if (!input.monitor) return viewerResult.transcript;
  const monitorResult = await sendMonitorPostRevealReview({
    repository: input.repository,
    sessionId: input.sessionId,
    existingTranscript: viewerResult.transcript,
    providerConfig: input.monitor.providerConfig,
    model: input.monitor.model,
    timeoutMs: input.timeoutMs,
    ...(input.chat ? { chat: input.chat } : {}),
  });
  return monitorResult.transcript;
}

export async function sendMonitorPostRevealReview(input: {
  repository: MonitorPostRevealRepository;
  sessionId: string;
  existingTranscript: string;
  providerConfig: ProviderConfig;
  model: ProviderModel;
  timeoutMs?: number;
  chat?: (request: { config: ProviderConfig; modelId: string; messages: ProviderMessage[]; settings: ReturnType<typeof resolveGenerationSettings>; timeoutMs?: number }) => Promise<ProviderChatResponse>;
}): Promise<{ transcript: string; response: ProviderChatResponse }> {
  const [snapshot, reveal, evidence, clarifications] = await Promise.all([
    input.repository.getSessionSnapshot(input.sessionId),
    input.repository.getReveal(input.sessionId),
    input.repository.getViewerEvidence(input.sessionId),
    input.repository.listTargetClarifications(input.sessionId),
  ]);
  if (!snapshot?.monitor || !reveal) throw new Error("A captured Monitor route and accepted Reveal are required for the Monitor post-reveal review.");
  if (snapshot.monitor.providerConfigId !== input.providerConfig.id || snapshot.monitor.modelId !== input.model.modelId) {
    throw new Error("The post-reveal Monitor review must use the Monitor route captured in the Session Snapshot.");
  }
  const runs = await input.repository.listMonitorRuns(snapshot.workspaceId);
  const run = runs.find((item) => item.sessionId === input.sessionId);
  const interventions = run ? await input.repository.listMonitorInterventions(run.id) : [];
  const imageArtifacts = (reveal.artifactManifest ?? []).filter((artifact) => artifact.mimeType.startsWith("image/"));
  if (imageArtifacts.length && (!input.model.capabilities.supportsVision || !input.model.capabilities.inputModalities.includes("image"))) {
    throw new Error("The captured Monitor route cannot receive this image Reveal for its post-reveal review.");
  }
  const images = await Promise.all(imageArtifacts.map(loadRevealImageForJudge));
  const language = snapshot.sessionLanguage;
  const system = `${snapshot.monitor.effectivePrompt ?? buildEffectiveMonitorPrompt(language)}\n\n${language === "pl"
    ? "[TRYB OCENY PO REVEALU] Ślepa część sesji została zakończona. Reguła wymian fazowych nie ma w tym trybie zastosowania. Zwróć jedną rzetelną analizę sesji, pracy Viewera i własnej pracy Monitora. Nie dopisuj niczego do zapieczętowanego transcriptu pre-reveal."
    : "[POST-REVEAL REVIEW MODE] The blind portion of the session has ended. The phase-exchange rule does not apply in this mode. Return one candid analysis of the session, the Viewer's work, and your own Monitor work. Do not add anything to the sealed pre-reveal transcript."}`;
  const viewerTurns = parsePostRevealTranscript(input.existingTranscript).filter((turn) => turn.role === "assistant");
  const packet = [
    `[TARGET REVEAL EXPLICITLY SUPPLIED]\n${reveal.text?.trim() || "(image Reveal attached)"}`,
    `[SEALED PRE-REVEAL EVIDENCE — READ ONLY]\n${evidence}`,
    interventions.length ? `[YOUR RECORDED MONITOR INTERVENTIONS]\n${interventions.map((item) => `${item.sequenceNumber}. ${item.decision}${item.commandText ? ` — ${item.commandText}` : ""}`).join("\n")}` : "[YOUR RECORDED MONITOR INTERVENTIONS]\nNo interventions were recorded.",
    viewerTurns.length ? `[VIEWER POST-REVEAL COMMENT]\n${viewerTurns.at(-1)?.content}` : "[VIEWER POST-REVEAL COMMENT]\nNo Viewer comment was recorded.",
    clarifications.length ? `[SUPPLEMENTARY TARGET CLARIFICATIONS — POST-REVEAL ONLY]\n${clarifications.map((item) => item.content).join("\n\n")}` : "",
  ].filter(Boolean).join("\n\n");
  const messages: ProviderMessage[] = [{ role: "system", content: system }, { role: "user", content: packet, ...(images.length ? { images } : {}) }];
  const response = (await callWithAnalyticalOutputRecovery({
    model: input.model,
    messages,
    call: (settings) => (input.chat ?? nativeProviderChat)({ config: input.providerConfig, modelId: input.model.modelId, messages, settings, timeoutMs: input.timeoutMs }),
  })).response;
  const transcript = await input.repository.appendPostRevealTurn(input.sessionId, "monitor", response.content);
  return { transcript, response };
}

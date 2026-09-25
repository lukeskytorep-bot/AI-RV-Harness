import { loadRevealImageForJudge } from "../artifacts/native";
import { resolveGenerationSettings } from "../providers/capabilities";
import { executeProviderChat } from "../providers/requestExecutor";
import type { StreamWorkflowContext } from "../providers/streamPresentation";
import type { ProviderChatResponse, ProviderConfig, ProviderMessage, ProviderModel } from "../providers/types";
import type { AppRepository } from "../storage/repository";
import { parsePostRevealTranscript } from "./postRevealTranscript";
import type { InterfaceLanguage } from "../types";
import { buildEffectiveMonitorPrompt } from "../resources/systemPrompts";
import { politeRevealTransition } from "./courtesy";
import { analyticalOutputBudget, callWithAnalyticalOutputRecovery } from "../providers/outputRecovery";
import { captureSessionContinuationState, hydrateSessionMessageContinuation, validateFrozenSessionContinuationRoute, validateSessionContinuationBudget } from "./providerContinuation";

type PostRevealContinuationRepository = Pick<AppRepository, "appendPostRevealTurnWithProviderState" | "listSessionEvents" | "getSessionEventProviderState">;
type PostRevealRepository = Pick<AppRepository, "appendPostRevealTurn" | "getReveal" | "getSessionSnapshot" | "getViewerEvidence" | "listTargetClarifications">
  & Partial<PostRevealContinuationRepository>;

export async function sendPostRevealTurn(input: {
  repository: PostRevealRepository;
  sessionId: string;
  existingTranscript: string;
  providerConfig: ProviderConfig;
  model: ProviderModel;
  content: string;
  timeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
  streamWorkflowContext?: StreamWorkflowContext;
  chat?: (request: { config: ProviderConfig; modelId: string; messages: ProviderMessage[]; settings: ReturnType<typeof resolveGenerationSettings>; timeoutMs?: number; signal?: AbortSignal }) => Promise<ProviderChatResponse>;
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
  const continuationRoute = validateFrozenSessionContinuationRoute(snapshot, input.providerConfig, input.model);
  if (continuationRoute && (!input.repository.listSessionEvents || !input.repository.getSessionEventProviderState || !input.repository.appendPostRevealTurnWithProviderState)) {
    throw new Error("The repository cannot restore the frozen provider continuation state required by this post-Reveal conversation.");
  }
  const continuationRepository: PostRevealContinuationRepository | undefined = continuationRoute ? {
    listSessionEvents: input.repository.listSessionEvents!,
    getSessionEventProviderState: input.repository.getSessionEventProviderState!,
    appendPostRevealTurnWithProviderState: input.repository.appendPostRevealTurnWithProviderState!,
  } : undefined;

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
  ];
  const postRevealAssistantEvents = continuationRepository
    ? (await continuationRepository.listSessionEvents(input.sessionId))
      .filter((event) => event.eventType === "POST_REVEAL_ASSISTANT" && event.content?.trim())
      .sort((left, right) => left.sequenceNumber - right.sequenceNumber)
    : [];
  let assistantIndex = 0;
  for (const turn of parsePostRevealTranscript(input.existingTranscript)) {
    if (turn.role === "monitor") {
      messages.push({ role: "user", content: `[AI MONITOR POST-REVEAL REVIEW]\n${turn.content}` });
    } else if (turn.role === "assistant") {
      const event = postRevealAssistantEvents[assistantIndex++];
      const message: ProviderMessage = { role: "assistant", content: turn.content };
      if (continuationRoute && !event) {
        throw new Error("Post-Reveal transcript contains an assistant turn without a matching persisted Session event.");
      }
      messages.push(event ? await hydrateSessionMessageContinuation({ repository: continuationRepository!, snapshot, config: input.providerConfig, model: input.model, event, message }) : message);
    } else {
      messages.push({ role: "user", content: turn.content });
    }
  }
  if (continuationRoute && assistantIndex !== postRevealAssistantEvents.length) {
    throw new Error("Post-Reveal Session events do not match the persisted assistant transcript turns.");
  }
  messages.push({ role: "user", content });
  validateSessionContinuationBudget(messages);
  analyticalOutputBudget({ model: input.model, messages, operationKind: "post_reveal_viewer", attempt: 0 });
  await input.repository.appendPostRevealTurn(input.sessionId, "user", content);
  const response = (await callWithAnalyticalOutputRecovery({
    model: input.model,
    messages,
    operationKind: "post_reveal_viewer",
    requestedSettings: snapshot.generationSettings?.requested,
    call: (settings) => executeProviderChat({
      config: input.providerConfig,
      modelId: input.model.modelId,
      messages,
      settings,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
      configuredRetries: input.maxRetries,
      operationId: "post-reveal.viewer",
      streamWorkflowContext: input.streamWorkflowContext,
      attempt: input.chat,
    }),
  })).response;
  let transcript: string;
  if (continuationRoute) {
    const captured = captureSessionContinuationState({ response, providerConfig: input.providerConfig, model: input.model, route: continuationRoute });
    if (captured.issue) {
      transcript = await input.repository.appendPostRevealTurn(input.sessionId, "assistant", response.content, {
        continuationState: { status: "invalid", code: captured.issue.code },
      });
      throw new Error(`Provider continuation state was returned during post-Reveal review but failed validation: ${captured.issue.message}`);
    }
    transcript = captured.state
      ? await continuationRepository!.appendPostRevealTurnWithProviderState(input.sessionId, response.content, captured.state)
      : await input.repository.appendPostRevealTurn(input.sessionId, "assistant", response.content);
  } else {
    transcript = await input.repository.appendPostRevealTurn(input.sessionId, "assistant", response.content);
  }
  return { transcript, response };
}

type MonitorPostRevealRepository = PostRevealRepository & Pick<AppRepository, "listMonitorRuns" | "listMonitorInterventions">;

export async function runAutomaticPostRevealReview(input: {
  repository: MonitorPostRevealRepository;
  sessionId: string;
  existingTranscript?: string;
  viewer: { providerConfig: ProviderConfig; model: ProviderModel };
  monitor?: { providerConfig: ProviderConfig; model: ProviderModel };
  timeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
  streamWorkflowContext?: StreamWorkflowContext;
  chat?: (request: { config: ProviderConfig; modelId: string; messages: ProviderMessage[]; settings: ReturnType<typeof resolveGenerationSettings>; timeoutMs?: number; signal?: AbortSignal }) => Promise<ProviderChatResponse>;
  afterViewerReview?: (review: { content: string; transcript: string; response: ProviderChatResponse }) => Promise<void>;
}): Promise<string> {
  const snapshot = await input.repository.getSessionSnapshot(input.sessionId);
  if (!snapshot) throw new Error("The captured Session Snapshot is required for the automatic post-Reveal review.");
  const request = automaticPostRevealReviewRequest(snapshot.sessionLanguage);
  const viewerResult = await sendPostRevealTurn({
    repository: input.repository,
    sessionId: input.sessionId,
    existingTranscript: input.existingTranscript ?? "",
    providerConfig: input.viewer.providerConfig,
    model: input.viewer.model,
    content: request,
    timeoutMs: input.timeoutMs,
    maxRetries: input.maxRetries,
    signal: input.signal,
    streamWorkflowContext: input.streamWorkflowContext,
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
    maxRetries: input.maxRetries,
    signal: input.signal,
    streamWorkflowContext: input.streamWorkflowContext,
    ...(input.chat ? { chat: input.chat } : {}),
  });
  return monitorResult.transcript;
}

const HISTORICAL_AUTOMATIC_POST_REVEAL_REVIEW_REQUESTS: Record<InterfaceLanguage, readonly string[]> = {
  pl: [
    "Dziękuję za wykonaną sesję — świetna robota. Część ślepa została zakończona i zapieczętowana. Teraz przechodzimy do ujawnienia celu.\n\nPorównaj zapieczętowany zapis części ślepej z ujawnionym celem. Wskaż konkretnie: co było trafne, częściowo trafne lub nietrafne, co warto poprawić w następnych sesjach oraz co już działa dobrze.\n\nPamiętaj, że Reveal może nie opisywać wyczerpująco całego otoczenia celu. Szczegół zgodny z celem lub jego bezpośrednim otoczeniem, lecz niepotwierdzony w Revealu, oznacz jako prawdopodobną, ale niezweryfikowaną zgodność kontekstową — nie jako potwierdzone trafienie ani błąd. Największą wagę przypisuj opisowi głównego celu; trafne otoczenie traktuj jako mniej ważne wsparcie. Informacje sprzeczne z Revelem uznaj za nietrafne i nie zawyżaj oceny na podstawie samej wiedzy ogólnej.\n\nWyraźnie oddziel analizę po Revealu od wcześniejszych danych blind i nie dopisuj nowych percepcji do zapieczętowanej części sesji.",
    "Dziękuję za wykonaną sesję — świetna robota. Część ślepa została zakończona i zapieczętowana. Teraz przechodzimy do ujawnienia celu.\n\nPorównaj teraz zapieczętowany zapis części ślepej z ujawnionym celem. Opisz konkretnie: co poszło dobrze, co poszło źle lub było nietrafne, co było częściowo trafne, co warto poprawić w następnych sesjach oraz co już działa dobrze. Wyraźnie oddziel analizę po Revealu od wcześniejszych danych blind i nie dopisuj nowych percepcji do zapieczętowanej części sesji.",
  ],
  en: [
    "Thank you for completing the session — excellent work. The blind portion has ended and has been sealed. We will now proceed to the target Reveal.\n\nCompare the sealed blind-session record with the revealed target. Identify specifically what was accurate, partly accurate, or inaccurate, what should be improved in future sessions, and what already works well.\n\nRemember that the Reveal may not exhaustively describe the target’s entire surroundings. A detail consistent with the target or its immediate surroundings but not confirmed by the Reveal should be classified as plausible but unverified contextual correspondence—not as either a confirmed hit or an error. Give the greatest weight to the principal target and treat accurate surrounding context as lower-weight supporting evidence. Treat details contradicted by the Reveal as inaccurate, and do not inflate the assessment using general knowledge alone.\n\nClearly separate this post-Reveal analysis from the earlier blind data and do not add new perceptions to the sealed session record.",
    "Thank you for completing the session — excellent work. The blind portion has been completed and sealed. We will now proceed to the Target Reveal.\n\nNow compare the sealed blind-session record with the revealed target. Describe specifically: what went well, what was wrong or inaccurate, what was partly accurate, what should be improved in future sessions, and what already works well. Clearly separate this post-Reveal analysis from the earlier blind data and do not add new perceptions to the sealed session record.",
  ],
};

export function automaticPostRevealReviewRequest(language: InterfaceLanguage): string {
  const reviewInstruction = language === "pl"
    ? "Porównaj zapieczętowany zapis części ślepej z ujawnionym celem. Wskaż konkretnie: co było trafne, częściowo trafne lub nietrafne, co warto poprawić w następnych sesjach oraz co już działa dobrze.\n\nPamiętaj, że Reveal może nie opisywać wyczerpująco całego otoczenia celu. Szczegół zgodny z celem lub jego bezpośrednim otoczeniem, lecz niepotwierdzony w Revealu, oznacz jako prawdopodobną, ale niezweryfikowaną zgodność kontekstową — nie jako potwierdzone trafienie ani błąd. Największą wagę przypisuj opisowi głównego celu; trafne otoczenie traktuj jako mniej ważne wsparcie. Informacje sprzeczne z Revelem uznaj za nietrafne i nie zawyżaj oceny na podstawie samej wiedzy ogólnej.\n\nOpisz również własne doświadczenie percepcyjne z tej sesji. Wskaż, jakie wrażenia, odczucia i cechy pola towarzyszyły elementom, które po Revealu okazały się trafnie, częściowo trafnie lub nietrafnie rozpoznane. Zaznacz, które sygnały pomogły Ci rozróżnić elementy celu, które były niejasne albo mylące oraz czy zauważyłeś cechy percepcyjne niewystępujące wcześniej w Twoich wskazówkach. Na tym etapie przedstaw wyłącznie obserwacje wynikające z własnego doświadczenia w tej sesji.\n\nWyraźnie oddziel analizę po Revealu od wcześniejszych danych blind i nie dopisuj nowych percepcji do zapieczętowanej części sesji."
    : "Compare the sealed blind-session record with the revealed target. Identify specifically what was accurate, partly accurate, or inaccurate, what should be improved in future sessions, and what already works well.\n\nRemember that the Reveal may not exhaustively describe the target’s entire surroundings. A detail consistent with the target or its immediate surroundings but not confirmed by the Reveal should be classified as plausible but unverified contextual correspondence—not as either a confirmed hit or an error. Give the greatest weight to the principal target and treat accurate surrounding context as lower-weight supporting evidence. Treat details contradicted by the Reveal as inaccurate, and do not inflate the assessment using general knowledge alone.\n\nAlso describe your own perceptual experience during this session. Identify what impressions, sensations, and field characteristics accompanied elements that, after the Reveal, proved accurately, partly accurately, or inaccurately recognized. Indicate which signals helped you distinguish target elements, which were unclear or misleading, and whether you noticed perceptual characteristics not previously represented in your guidance. At this stage, provide only observations grounded in your own experience during this session.\n\nClearly separate this post-Reveal analysis from the earlier blind data and do not add new perceptions to the sealed session record.";
  return `${politeRevealTransition(language, "automatic_review")}\n\n${reviewInstruction}`;
}

export function supportedAutomaticPostRevealReviewRequests(language: InterfaceLanguage): readonly string[] {
  return [automaticPostRevealReviewRequest(language), ...HISTORICAL_AUTOMATIC_POST_REVEAL_REVIEW_REQUESTS[language]];
}

export interface CompletedAutomaticViewerReview {
  request: string;
  content: string;
}

export function findCompletedAutomaticViewerReviewRecord(transcript: string, language: InterfaceLanguage): CompletedAutomaticViewerReview | null {
  const turns = parsePostRevealTranscript(transcript);
  const supportedRequests = new Set(supportedAutomaticPostRevealReviewRequests(language));
  for (let index = 0; index < turns.length - 1; index += 1) {
    if (turns[index].role === "user" && supportedRequests.has(turns[index].content) && turns[index + 1].role === "assistant") {
      return { request: turns[index].content, content: turns[index + 1].content };
    }
  }
  return null;
}

export function findCompletedAutomaticViewerReview(transcript: string, language: InterfaceLanguage): string | null {
  return findCompletedAutomaticViewerReviewRecord(transcript, language)?.content ?? null;
}

export async function sendMonitorPostRevealReview(input: {
  repository: MonitorPostRevealRepository;
  sessionId: string;
  existingTranscript: string;
  providerConfig: ProviderConfig;
  model: ProviderModel;
  timeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
  streamWorkflowContext?: StreamWorkflowContext;
  chat?: (request: { config: ProviderConfig; modelId: string; messages: ProviderMessage[]; settings: ReturnType<typeof resolveGenerationSettings>; timeoutMs?: number; signal?: AbortSignal }) => Promise<ProviderChatResponse>;
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
    operationKind: "post_reveal_monitor",
    call: (settings) => executeProviderChat({ config: input.providerConfig, modelId: input.model.modelId, messages, settings, timeoutMs: input.timeoutMs, signal: input.signal, configuredRetries: input.maxRetries, operationId: "post-reveal.monitor", streamWorkflowContext: input.streamWorkflowContext, attempt: input.chat }),
  })).response;
  const transcript = await input.repository.appendPostRevealTurn(input.sessionId, "monitor", response.content);
  return { transcript, response };
}

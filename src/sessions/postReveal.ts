import { loadRevealImageForJudge } from "../artifacts/native";
import { resolveGenerationSettings } from "../providers/capabilities";
import { providerChat as nativeProviderChat } from "../providers/native";
import type { ProviderChatResponse, ProviderConfig, ProviderMessage, ProviderModel } from "../providers/types";
import type { AppRepository } from "../storage/repository";
import { parsePostRevealTranscript } from "./postRevealTranscript";

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
    ...parsePostRevealTranscript(input.existingTranscript).map((turn) => ({ role: turn.role, content: turn.content } satisfies ProviderMessage)),
    { role: "user", content },
  ];
  const maxOutputTokens = Math.min(input.model.capabilities.maxOutputTokens ?? 4096, 4096);
  const estimatedInputTokens = Math.ceil(messages.reduce((sum, message) => sum + message.content.length, 0) / 3.5) + images.length * 1500;
  if (input.model.capabilities.contextTokens && estimatedInputTokens + maxOutputTokens > input.model.capabilities.contextTokens) {
    throw new Error("Post-reveal discussion exceeds this model route's available context.");
  }
  const settings = resolveGenerationSettings(input.model.capabilities, { maxOutputTokens });

  await input.repository.appendPostRevealTurn(input.sessionId, "user", content);
  const response = await (input.chat ?? nativeProviderChat)({
    config: input.providerConfig,
    modelId: input.model.modelId,
    messages,
    settings,
    timeoutMs: input.timeoutMs,
  });
  const transcript = await input.repository.appendPostRevealTurn(input.sessionId, "assistant", response.content);
  return { transcript, response };
}

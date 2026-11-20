import type { ProviderMessage } from "./types";
export const CLOUD_CONFORMANCE_OPERATION = "cloud.conformance.v1";
export const CLOUD_CONFORMANCE_BUDGET = 4096;
const firstPrefix = "Keep this random test marker for the next turn: ";
const firstSuffix = ". Reply with READY only.";
export const CLOUD_CONFORMANCE_RECALL = "Return only the marker from the first user message. No other text.";
export function cloudConformanceFirstMessage(marker: string): ProviderMessage {
  if (!/^rvh_cloud_[a-f0-9]{32}$/.test(marker)) throw new Error("Invalid diagnostic marker.");
  return { role: "user", content: `${firstPrefix}${marker}${firstSuffix}` };
}
/** Only this bounded synthetic probe may use the diagnostic exception, never arbitrary workflow input. */
export function isCloudConformanceProbe(operationId: string | undefined, messages: ProviderMessage[], budget: number | undefined): boolean {
  if (operationId !== CLOUD_CONFORMANCE_OPERATION || budget !== CLOUD_CONFORMANCE_BUDGET || ![1, 3].includes(messages.length)) return false;
  if (messages.some(m => Object.keys(m).some(k => k !== "role" && k !== "content"))) return false;
  const first = messages[0];
  if (first.role !== "user" || typeof first.content !== "string" || !first.content.startsWith(firstPrefix) || !first.content.endsWith(firstSuffix)) return false;
  const marker = first.content.slice(firstPrefix.length, -firstSuffix.length);
  if (!/^rvh_cloud_[a-f0-9]{32}$/.test(marker)) return false;
  return messages.length === 1 || (messages[1].role === "assistant" && messages[1].content === "READY" && messages[2].role === "user" && messages[2].content === CLOUD_CONFORMANCE_RECALL);
}

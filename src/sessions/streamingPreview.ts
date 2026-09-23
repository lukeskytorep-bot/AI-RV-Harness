import type { ProviderStreamEvent } from "../providers/types";

export interface SessionStreamPreview {
  role: "viewer" | "monitor";
  content: string;
  phase?: number;
  exchangeNumber?: number;
  source?: string;
}

export function createSessionStreamPreviewHandler(input: {
  emit?: (preview: SessionStreamPreview | null) => void;
  role: SessionStreamPreview["role"];
  phase?: number;
  exchangeNumber?: number;
  source?: string;
}): ((event: ProviderStreamEvent) => void) | undefined {
  const emit = input.emit;
  if (!emit) return undefined;
  let content = "";
  return (event) => {
    if (event.event === "started") {
      content = "";
      emit(null);
      return;
    }
    if (event.event === "contentDelta") content += event.data.content;
    if (event.event !== "contentDelta") return;
    emit({
      role: input.role,
      content,
      ...(input.phase !== undefined ? { phase: input.phase } : {}),
      ...(input.exchangeNumber !== undefined ? { exchangeNumber: input.exchangeNumber } : {}),
      ...(input.source ? { source: input.source } : {}),
    });
  };
}

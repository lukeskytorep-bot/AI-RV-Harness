export const CONVERSATION_COMPOSER_MIN_ROWS = 2;
export const CONVERSATION_COMPOSER_MAX_VISIBLE_LINES = 18;
export const CONVERSATION_COMPOSER_MAX_VIEWPORT_RATIO = 0.45;

export interface ConversationComposerSizeInput {
  scrollHeight: number;
  minHeight: number;
  lineHeight: number;
  verticalPadding: number;
  viewportHeight: number;
}

export interface ConversationComposerSize {
  height: number;
  maxHeight: number;
  overflowY: "hidden" | "auto";
}

export function calculateConversationComposerSize(input: ConversationComposerSizeInput): ConversationComposerSize {
  const safeMinHeight = Math.max(0, input.minHeight);
  const lineLimitedHeight = Math.max(
    safeMinHeight,
    (Math.max(0, input.lineHeight) * CONVERSATION_COMPOSER_MAX_VISIBLE_LINES) + Math.max(0, input.verticalPadding),
  );
  const viewportLimitedHeight = Math.max(
    safeMinHeight,
    Math.max(0, input.viewportHeight) * CONVERSATION_COMPOSER_MAX_VIEWPORT_RATIO,
  );
  const maxHeight = Math.min(lineLimitedHeight, viewportLimitedHeight);
  const height = Math.max(safeMinHeight, Math.min(Math.max(0, input.scrollHeight), maxHeight));

  return {
    height,
    maxHeight,
    overflowY: input.scrollHeight > maxHeight ? "auto" : "hidden",
  };
}

function readPixelValue(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function autosizeConversationComposer(textarea: HTMLTextAreaElement, viewportHeight = window.innerHeight): ConversationComposerSize {
  textarea.style.height = "auto";

  const computed = window.getComputedStyle(textarea);
  const fontSize = readPixelValue(computed.fontSize) || 12;
  const lineHeight = readPixelValue(computed.lineHeight) || fontSize * 1.5;
  const verticalPadding = readPixelValue(computed.paddingTop) + readPixelValue(computed.paddingBottom);
  const minHeight = readPixelValue(computed.minHeight) || ((lineHeight * CONVERSATION_COMPOSER_MIN_ROWS) + verticalPadding);
  const size = calculateConversationComposerSize({
    scrollHeight: textarea.scrollHeight,
    minHeight,
    lineHeight,
    verticalPadding,
    viewportHeight,
  });

  textarea.style.height = `${size.height}px`;
  textarea.style.overflowY = size.overflowY;
  return size;
}

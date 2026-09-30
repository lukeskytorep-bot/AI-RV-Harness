import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const chatPanel = readFileSync(new URL("./ChatPanel.tsx", import.meta.url), "utf8");
const composerCss = readFileSync(new URL("../../styles/conversations.css", import.meta.url), "utf8");
const sizingHelper = readFileSync(new URL("./composerSizing.ts", import.meta.url), "utf8");

function composerTextareaMarkup(): string {
  const match = chatPanel.match(/<textarea ref=\{composerTextareaRef\}[\s\S]*?\/>/);
  if (!match) throw new Error("Conversation composer textarea not found");
  return match[0];
}

describe("CONVERSATION-COMPOSER-1 integration boundary", () => {
  it("remeasures whenever the controlled value changes, so send/clear resets height", () => {
    expect(chatPanel).toContain("useLayoutEffect(() => {");
    expect(chatPanel).toContain("resizeComposer();");
    expect(chatPanel).toContain("}, [input, resizeComposer]);");
    expect(chatPanel).toContain('setInput("");');
  });

  it("preserves the draft-restoration and pending-turn error safeguards", () => {
    expect(chatPanel).toContain("setInput(content);");
    expect(chatPanel).toContain("savePendingChatTurn(pending);");
    expect(chatPanel).toContain("setPendingRetry(pending);");
  });

  it("does not change the existing send/newline/IME keyboard behavior", () => {
    const textarea = composerTextareaMarkup();
    expect(textarea).toContain("onChange={(event) => setInput(event.target.value)}");
    expect(textarea).not.toContain("onKeyDown");
    expect(textarea).not.toContain("onKeyPress");
    expect(chatPanel).toContain('onClick={() => void send()}');
  });

  it("keeps disabled state, attachments and send actions unchanged while allowing vertical manual resize", () => {
    const textarea = composerTextareaMarkup();
    expect(textarea).toContain("disabled={!selectedModel || sending || Boolean(pendingRetry)}");
    expect(chatPanel).toContain("composer-attachment-button");
    expect(chatPanel).toContain("disabled={!selectedModel || !input.trim() || sending || contextExceeded || Boolean(pendingRetry)}");
    expect(composerCss).toContain("resize: vertical;");
  });

  it("remeasures on window resize and limits growth inside the Conversation stylesheet only", () => {
    expect(chatPanel).toContain('window.addEventListener("resize", resizeComposer);');
    expect(chatPanel).toContain('window.removeEventListener("resize", resizeComposer);');
    expect(composerCss).toContain("max-height: min(45vh, calc(27em + 14px));");
    expect(composerCss).toContain("overflow-y: hidden;");
  });

  it("keeps the sizing helper inside the Conversations feature and free of cross-domain dependencies", () => {
    expect(chatPanel).toContain('import { autosizeConversationComposer } from "./composerSizing";');
    expect(sizingHelper).not.toMatch(/^import /m);
    expect(sizingHelper).not.toContain("providers/");
    expect(sizingHelper).not.toContain("storage/");
    expect(sizingHelper).not.toContain("research/");
    expect(sizingHelper).not.toContain("training/");
  });
});

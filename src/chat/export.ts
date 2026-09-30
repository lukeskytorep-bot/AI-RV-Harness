import type { ChatMessage, ChatMode, ChatThread, InterfaceLanguage, Profile, Workspace } from "../types";
import { renderMarkdownExportDocument } from "../exports/document";

export function buildChatMarkdownExport(input: {
  language: InterfaceLanguage;
  mode: ChatMode;
  thread: ChatThread;
  workspace: Workspace;
  profile: Profile | null;
  messages: ChatMessage[];
  modelId?: string;
  exportedAt?: Date;
}): { fileName: string; content: string } {
  const exportedAt = input.exportedAt ?? new Date();
  const aiName = input.profile?.name.trim() || "AI IS-BE";
  const humanName = input.profile?.humanName?.trim() || "Human IS-BE";
  const label = input.language === "pl"
    ? { empty: "Brak wiadomości w tej rozmowie.", conversation: "Konwersacja", manual: "Manual RV" }
    : { empty: "This conversation contains no messages.", conversation: "Conversation", manual: "Manual RV" };
  const lines: string[] = [];
  if (!input.messages.length) lines.push(label.empty, "");
  for (const message of input.messages) {
    const author = message.role === "user" ? humanName : aiName;
    lines.push(`## ${author}`, "", message.content.trim(), "");
  }
  return {
    fileName: `${safeFileName(input.thread.title) || "conversation"}.md`,
    content: renderMarkdownExportDocument({
      language: input.language,
      title: input.thread.title,
      metadata: {
        workspace: input.workspace.name,
        profile: aiName,
        mode: input.mode === "conversation" ? label.conversation : label.manual,
        ...(input.modelId?.trim() ? { viewerModel: input.modelId.trim() } : {}),
        createdAt: input.thread.createdAt,
        exportedAt,
      },
      body: lines.join("\n"),
    }),
  };
}

function safeFileName(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/[. ]+$/g, "").slice(0, 120);
}

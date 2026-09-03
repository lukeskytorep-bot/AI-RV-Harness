import type { ChatMessage, ChatMode, ChatThread, InterfaceLanguage, Profile, Workspace } from "../types";

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
  const locale = input.language === "pl" ? "pl-PL" : "en-GB";
  const aiName = input.profile?.name.trim() || "AI IS-BE";
  const humanName = input.profile?.humanName?.trim() || "Human IS-BE";
  const label = input.language === "pl"
    ? { workspace: "Przestrzeń robocza", profile: "Profil", mode: "Tryb", created: "Utworzono", exported: "Wyeksportowano", model: "Model", empty: "Brak wiadomości w tej rozmowie.", conversation: "Konwersacja", manual: "Manual RV" }
    : { workspace: "Workspace", profile: "Profile", mode: "Mode", created: "Created", exported: "Exported", model: "Model", empty: "This conversation contains no messages.", conversation: "Conversation", manual: "Manual RV" };
  const lines = [
    `# ${input.thread.title}`,
    "",
    `- ${label.workspace}: ${input.workspace.name}`,
    `- ${label.profile}: ${aiName}`,
    `- ${label.mode}: ${input.mode === "conversation" ? label.conversation : label.manual}`,
    `- ${label.created}: ${formatDateTime(input.thread.createdAt, locale)}`,
    `- ${label.exported}: ${new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "long" }).format(exportedAt)}`,
    ...(input.modelId?.trim() ? [`- ${label.model}: ${input.modelId.trim()}`] : []),
    "",
    "---",
    "",
  ];
  if (!input.messages.length) lines.push(label.empty, "");
  for (const message of input.messages) {
    const author = message.role === "user" ? humanName : aiName;
    const heading = input.mode === "manual_rv" ? `## ${author}` : `## ${author} · ${formatDateTime(message.createdAt, locale)}`;
    lines.push(heading, "", message.content.trim(), "");
  }
  return { fileName: `${safeFileName(input.thread.title) || "conversation"}.md`, content: `${lines.join("\n").trimEnd()}\n` };
}

function formatDateTime(value: string, locale: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium" }).format(date);
}

function safeFileName(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/[. ]+$/g, "").slice(0, 120);
}

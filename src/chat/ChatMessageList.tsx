import type { ReactNode } from "react";

import { SafeMarkdown } from "../components/SafeMarkdown";
import { aiIsBeDisplayName, humanIsBeDisplayName } from "../domain/isBeIdentity";
import type { ChatMessage, ChatMode, InterfaceLanguage, Profile } from "../types";

export interface ChatMessageListProps {
  language: InterfaceLanguage;
  mode: ChatMode;
  threadCreatedAt?: string;
  messages: ChatMessage[];
  profile: Profile | null;
  sending: boolean;
  sendingLabel: string;
  emptyState: ReactNode;
}

export function ChatMessageList({ language, mode, threadCreatedAt, messages, profile, sending, sendingLabel, emptyState }: ChatMessageListProps) {
  const conversationStarted = mode === "conversation" && threadCreatedAt
    ? formatConversationStarted(threadCreatedAt, language)
    : null;

  return <>
    {conversationStarted && <div className="chat-date-separator conversation-start-time"><span>{conversationStarted}</span></div>}
    {messages.length === 0 ? emptyState : <div className="message-list">
      {messages.map((message) => {
        const displayName = message.role === "user" ? humanIsBeDisplayName(profile) : aiIsBeDisplayName(profile);
        return <div className="chat-message-block" key={message.id}>
          <article className={`chat-message ${message.role}`}>
            <span>{initials(displayName)}</span>
            <div><small>{displayName}</small><SafeMarkdown content={message.content} /></div>
          </article>
        </div>;
      })}
      {sending && <div className="typing-row"><span className="loader-orb" />{sendingLabel}</div>}
    </div>}
  </>;
}

function formatConversationStarted(value: string, language: InterfaceLanguage): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const locale = language === "pl" ? "pl-PL" : "en-GB";
  const formatted = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short" }).format(date);
  return language === "pl" ? `Rozmowa rozpoczęta: ${formatted}` : `Conversation started: ${formatted}`;
}

function initials(value: string): string {
  return value.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "AI";
}

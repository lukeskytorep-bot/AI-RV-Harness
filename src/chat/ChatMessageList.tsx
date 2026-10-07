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
  streamingAssistant?: string;
  sending: boolean;
  sendingLabel: string;
  emptyState: ReactNode;
}

export function ChatMessageList({ language, mode, threadCreatedAt, messages, profile, streamingAssistant = "", sending, sendingLabel, emptyState }: ChatMessageListProps) {
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
            <div><small>{displayName}</small><SafeMarkdown content={message.content} />{message.role === "user" && message.metadata?.attachmentAttempts?.length ? <div className="chat-message-attachments">{message.metadata.attachmentAttempts.map((attempt) => <small key={attempt.attemptNumber}>{language === "pl" ? `Próba ${attempt.attemptNumber}` : `Attempt ${attempt.attemptNumber}`}: {[...attempt.sources.map((source) => `${source.name} · ${source.type.toUpperCase()}`), ...attempt.images.map((image) => `${image.name} · IMAGE · ${attachmentStateLabel(image.state, language)}`)].join(" · ")}</small>)}</div> : null}</div>
          </article>
        </div>;
      })}
      {streamingAssistant && <div className="chat-message-block provisional-stream" aria-live="polite">
        <article className="chat-message assistant">
          <span>{initials(aiIsBeDisplayName(profile))}</span>
          <div><small>{aiIsBeDisplayName(profile)}</small><SafeMarkdown content={streamingAssistant} /></div>
        </article>
      </div>}
      {sending && !streamingAssistant && <div className="typing-row"><span className="loader-orb" />{sendingLabel}</div>}
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

function attachmentStateLabel(state: import("../types").ChatAttachmentDeliveryState, language: InterfaceLanguage): string {
  if (state === "included_in_request") return language === "pl" ? "zawarty w żądaniu" : "included in request";
  if (state === "uncertain") return language === "pl" ? "wynik wysłania niepewny" : "send outcome uncertain";
  if (state === "not_included") return language === "pl" ? "nie wysłano" : "not sent";
  return language === "pl" ? "przygotowany" : "prepared";
}

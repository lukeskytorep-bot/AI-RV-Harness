import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ChatMessage, Profile } from "../types";
import { ChatMessageList } from "./ChatMessageList";

const createdAt = "2026-09-02T20:34:34.000Z";
const profile: Profile = { id: "p", name: "Nemo", humanName: "Ed", createdAt, updatedAt: createdAt };
const messages: ChatMessage[] = [
  { id: "m1", threadId: "t", role: "user", content: "Pierwsza wiadomość", createdAt: "2026-09-02T20:35:34.000Z" },
  { id: "m2", threadId: "t", role: "assistant", content: "Druga wiadomość", createdAt: "2026-09-02T20:35:47.000Z" },
];

describe("ChatMessageList time presentation", () => {
  it("shows one start date and time in Conversation and no per-message timestamps", () => {
    const html = renderToStaticMarkup(<ChatMessageList language="pl" mode="conversation" threadCreatedAt={createdAt} messages={messages} profile={profile} sending={false} sendingLabel="Wysyłanie" emptyState={null} />);

    expect(html.match(/conversation-start-time/g)).toHaveLength(1);
    expect(html).toContain("Rozmowa rozpoczęta:");
    expect(html).toContain("<small>Ed</small>");
    expect(html).toContain("<small>Nemo</small>");
    expect(html).not.toContain("<small>Ed ·");
    expect(html).not.toContain("<small>Nemo ·");
  });

  it("shows neither start date nor per-message timestamps in Manual RV", () => {
    const html = renderToStaticMarkup(<ChatMessageList language="pl" mode="manual_rv" threadCreatedAt={createdAt} messages={messages} profile={profile} sending={false} sendingLabel="Wysyłanie" emptyState={null} />);

    expect(html).not.toContain("conversation-start-time");
    expect(html).not.toContain("Rozmowa rozpoczęta:");
    expect(html).toContain("<small>Ed</small>");
    expect(html).toContain("<small>Nemo</small>");
    expect(html).not.toContain("<small>Ed ·");
    expect(html).not.toContain("<small>Nemo ·");
  });

  it("shows the Conversation start date before the first message is written", () => {
    const html = renderToStaticMarkup(<ChatMessageList language="en" mode="conversation" threadCreatedAt={createdAt} messages={[]} profile={profile} sending={false} sendingLabel="Sending" emptyState={<div>Empty conversation</div>} />);

    expect(html).toContain("Conversation started:");
    expect(html).toContain("Empty conversation");
  });
});

export interface PostRevealTurn {
  role: "user" | "assistant" | "monitor";
  content: string;
}

export function serializePostRevealTurn(role: PostRevealTurn["role"], content: string): string {
  return `${JSON.stringify({ role, content: content.trim() } satisfies PostRevealTurn)}\n`;
}

export function parsePostRevealTranscript(transcript: string): PostRevealTurn[] {
  const turns: PostRevealTurn[] = [];
  for (const line of transcript.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Partial<PostRevealTurn>;
      if ((parsed.role === "user" || parsed.role === "assistant" || parsed.role === "monitor") && typeof parsed.content === "string") {
        turns.push({ role: parsed.role, content: parsed.content });
      }
    } catch {
      // Older/non-JSON transcript material stays out of model role reconstruction.
    }
  }
  return turns;
}

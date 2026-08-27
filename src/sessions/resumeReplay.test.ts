import { describe, expect, it, vi } from "vitest";
import type { AppRepository } from "../storage/repository";
import type { RvSession, SessionEventRecord } from "./types";
import { createSessionReplay, isRecoverableProviderInterruption } from "./resumeReplay";

const session: RvSession = {
  id: "session_1", workspaceId: "w", profileId: "p", sessionCode: "RV-1", state: "Interrupted", runType: "automatic_monitor",
  preRevealTranscript: "saved", postRevealTranscript: "", createdAt: "2026-01-01", updatedAt: "2026-01-01",
};

function event(sequenceNumber: number, eventType: string, content?: string, metadata: Record<string, unknown> = {}): SessionEventRecord {
  return { id: `e${sequenceNumber}`, sessionId: session.id, sequenceNumber, eventType, ...(content ? { content } : {}), metadata, createdAt: "2026-01-01" };
}

describe("durable session replay", () => {
  it("recognizes provider interruptions but rejects user and cost stops", () => {
    expect(isRecoverableProviderInterruption(session, [event(1, "SESSION_STOPPED", "AUTO-STOP: Monitor provider failure — empty assistant response")])).toBe(true);
    expect(isRecoverableProviderInterruption(session, [event(1, "SESSION_STOPPED", "USER STOP")])).toBe(false);
    expect(isRecoverableProviderInterruption(session, [event(1, "SESSION_STOPPED", "AUTO-STOP: configured session cost limit exceeded")])).toBe(false);
  });

  it("replays saved responses and starts the provider only at the missing call", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const append = vi.fn().mockResolvedValue(undefined);
    const liveChat = vi.fn().mockResolvedValue({ content: "recovered", usage: {} });
    const repository = { updateRvSessionState: update, appendSessionEvent: append } as unknown as AppRepository;
    const replay = createSessionReplay({
      repository,
      session,
      events: [
        event(1, "VIEWER_RESPONSE", "saved viewer", { usage: { totalTokens: 10 } }),
        event(2, "MONITOR_TELEMETRY", "CONTINUE_PROTOCOL", { usage: { totalTokens: 2 } }),
        event(3, "MONITOR_TELEMETRY", "truncated monitor output that must not be replayed", { failed: true, finishReason: "length" }),
      ],
      liveChat,
    });
    const request = { config: {} as never, modelId: "m", messages: [], settings: { requested: {}, effective: {}, omitted: [] } };
    expect((await replay.chat(request)).content).toBe("saved viewer");
    expect((await replay.chat(request)).content).toBe("CONTINUE_PROTOCOL");
    expect(liveChat).not.toHaveBeenCalled();
    expect((await replay.chat(request)).content).toBe("recovered");
    expect(update).toHaveBeenCalledWith(session.id, "BlindRunning");
    expect(append).toHaveBeenCalledWith(session.id, expect.objectContaining({ eventType: "SESSION_RESUMED" }));
  });
});

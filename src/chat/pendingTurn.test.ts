import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../types";
import { loadPendingChatTurn, savePendingChatTurn, type PendingChatTurn } from "./pendingTurn";

function storageStub() {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  });
  return storage;
}

const message: ChatMessage = { id: "u1", threadId: "t1", role: "user", content: "hello", createdAt: "x" };
const base: PendingChatTurn = {
  threadId: "t1", mode: "conversation", language: "en", providerConfigId: "p", modelId: "m", content: "hello",
  requestedSettings: {}, sourceIds: [], images: [{ mimeType: "image/png", dataBase64: "SECRET_BYTES" }], imageNames: ["a.png"], createdAt: "x",
};

afterEach(() => vi.unstubAllGlobals());

describe("pending Conversation retry attachment safety", () => {
  it("never persists image bytes in a new pending turn", () => {
    const storage = storageStub();
    savePendingChatTurn(base);
    const raw = storage.get("rvh.pending-chat-turn.t1") ?? "";
    expect(raw).not.toContain("SECRET_BYTES");
    expect(JSON.parse(raw)).toMatchObject({ images: [], imageMimeTypes: ["image/png"], imageNames: ["a.png"] });
  });

  it("sanitizes legacy pending records on load and immediately erases stored image bytes", () => {
    const storage = storageStub();
    storage.set("rvh.pending-chat-turn.t1", JSON.stringify(base));
    const loaded = loadPendingChatTurn("t1", [message]);
    expect(loaded?.images).toEqual([]);
    expect(loaded?.imageMimeTypes).toEqual(["image/png"]);
    const rewritten = storage.get("rvh.pending-chat-turn.t1") ?? "";
    expect(rewritten).not.toContain("SECRET_BYTES");
    expect(JSON.parse(rewritten).images).toEqual([]);
  });
});

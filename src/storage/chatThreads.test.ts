import { beforeEach, describe, expect, it } from "vitest";
import { BrowserRepository } from "./browserRepository";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("multiple chat threads", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
  });

  it("keeps six or more independent histories and per-thread Source selections after repository restart", async () => {
    const repository = new BrowserRepository();
    const threads = [];
    for (let index = 1; index <= 6; index += 1) {
      const thread = await repository.createChatThread("workspace_1", "conversation", `Chat ${index}`);
      await repository.appendChatMessage(thread.id, "user", `Message ${index}`);
      await repository.setChatSourceActive(thread.id, `source_${index}`, true);
      threads.push(thread);
    }

    const restarted = new BrowserRepository();
    expect(await restarted.listChatThreads("workspace_1", "conversation")).toHaveLength(6);
    expect((await restarted.listChatMessages(threads[2].id)).map((item) => item.content)).toEqual(["Message 3"]);
    expect(await restarted.listActiveChatSourceIds(threads[2].id)).toEqual(["source_3"]);
    expect(await restarted.listActiveChatSourceIds(threads[3].id)).toEqual(["source_4"]);
  });

  it("archives legacy formal Manual RV states non-destructively", async () => {
    const repository = new BrowserRepository();
    const thread = await repository.createChatThread("workspace_1", "manual_rv", "Blind work");
    await repository.appendChatMessage(thread.id, "user", "Preserved evidence");
    await repository.setChatThreadFormalRvState(thread.id, "BLIND");
    await repository.archiveChatThread(thread.id);
    expect(await repository.listChatThreads("workspace_1", "manual_rv")).toEqual([]);
    expect((await repository.listChatMessages(thread.id))[0]?.content).toBe("Preserved evidence");
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { BrowserRepository } from "./browserRepository";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe("browser credential isolation", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
  });

  it("never persists provider credential metadata outside the desktop runtime", async () => {
    const repository = new BrowserRepository();
    await expect(repository.createProviderConfig({
      id: "provider_test",
      provider: "openrouter",
      label: "OpenRouter",
      credentialId: "credential_test",
      credentialHint: "sk-or-••••••••XYZ",
      fingerprint: "0123456789abcdef",
    })).rejects.toThrow("desktop runtime");
    expect(localStorage.getItem("rvh.dev.providers")).toBeNull();
  });
});

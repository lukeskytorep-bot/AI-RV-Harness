import { BrowserRepository } from "./browserRepository";
import type { AppRepository } from "./repository";
import { SqliteRepository } from "./sqliteRepository";

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function createRepository(): Promise<AppRepository> {
  if (isTauriRuntime()) {
    return SqliteRepository.connect();
  }
  return new BrowserRepository();
}

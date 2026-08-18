import { BrowserRepository } from "./browserRepository";
import type { AppRepository } from "./repository";
import { SqliteRepository } from "./sqliteRepository";

let nativeRepositoryPromise: Promise<AppRepository> | null = null;

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function createRepository(): Promise<AppRepository> {
  if (isTauriRuntime()) {
    if (!nativeRepositoryPromise) {
      nativeRepositoryPromise = SqliteRepository.connect().catch((cause) => {
        nativeRepositoryPromise = null;
        throw cause;
      });
    }
    return nativeRepositoryPromise;
  }
  return new BrowserRepository();
}

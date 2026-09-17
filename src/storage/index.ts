import { BrowserRepository } from "./browserRepository";
import type { AppRepository } from "./repository";
import { SqliteRepository } from "./sqliteRepository";
import { inspectDatabaseCompatibility, prepareDatabaseForLoad, validateLiveDatabase, type DatabaseCompatibilityStatus } from "./native";
export { closeApplication, openDataFolder, startFreshDatabase } from "./native";
export type { DatabaseCompatibilityStatus } from "./native";

let nativeRepositoryPromise: Promise<AppRepository> | null = null;

export class DatabaseCompatibilityError extends Error {
  constructor(public readonly status: DatabaseCompatibilityStatus) {
    super(status.detail ?? `Database compatibility gate blocked startup: ${status.kind}`);
    this.name = "DatabaseCompatibilityError";
  }
}


export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function createRepository(): Promise<AppRepository> {
  if (isTauriRuntime()) {
    if (!nativeRepositoryPromise) {
      nativeRepositoryPromise = inspectDatabaseCompatibility()
        .then(async (compatibility) => {
          if (compatibility.kind === "legacy" || compatibility.kind === "incomplete_current_initialization" || compatibility.kind === "corrupt_or_unknown") {
            throw new DatabaseCompatibilityError(compatibility);
          }
          const prepared = await prepareDatabaseForLoad();
          if (prepared.kind === "legacy" || prepared.kind === "incomplete_current_initialization" || prepared.kind === "corrupt_or_unknown") {
            throw new DatabaseCompatibilityError(prepared);
          }
          const repository = await SqliteRepository.connect();
          await validateLiveDatabase();
          return repository;
        })
        .catch((cause) => {
          nativeRepositoryPromise = null;
          throw cause;
        });
    }
    return nativeRepositoryPromise;
  }
  return new BrowserRepository();
}

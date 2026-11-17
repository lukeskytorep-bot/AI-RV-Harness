import type { CustomProtocolVersion, SaveCustomProtocolVersionInput } from "../../protocols/types";
import type { CustomProtocolsRepository } from "../contracts/customProtocolsRepository";

const CUSTOM_PROTOCOLS_KEY = "rvh.dev.custom_protocols";

export class BrowserCustomProtocolsRepository implements CustomProtocolsRepository {
  private readonly storage: Storage;
  constructor(dependencies: { storage?: Storage } = {}) {
    this.storage = dependencies.storage ?? localStorage;
  }
  private read<T>(key: string, fallback: T): T {
    try {
      const raw = this.storage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  }
  private write<T>(key: string, value: T): void {
    this.storage.setItem(key, JSON.stringify(value));
  }

  async listCustomProtocols(language?: "pl" | "en"): Promise<CustomProtocolVersion[]> {
    return this.read<CustomProtocolVersion[]>(CUSTOM_PROTOCOLS_KEY, []).filter((protocol) => !language || protocol.language === language).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveCustomProtocolVersion(input: SaveCustomProtocolVersionInput): Promise<CustomProtocolVersion> {
    const all = this.read<CustomProtocolVersion[]>(CUSTOM_PROTOCOLS_KEY, []);
    const record: CustomProtocolVersion = { ...input, steps: [...input.steps] };
    this.write(CUSTOM_PROTOCOLS_KEY, [record, ...all]);
    return record;
  }
}

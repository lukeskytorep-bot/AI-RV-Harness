import type { CustomProtocolVersion, SaveCustomProtocolVersionInput } from "../../protocols/types";

export interface CustomProtocolsRepository {
  listCustomProtocols(language?: "pl" | "en"): Promise<CustomProtocolVersion[]>;
  saveCustomProtocolVersion(input: SaveCustomProtocolVersionInput): Promise<CustomProtocolVersion>;
}
